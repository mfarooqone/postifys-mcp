import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PostifysApiError, PostifysClient, firstString, newIdempotencyKey, normalizeMediaUrls, toolError, toolResult } from '../client.js';
import { HONEST_LIMITS } from '../honesty.js';

const BLOCKED_DIRECT_URL = /drive\.google\.com|dropbox\.com|dropboxusercontent\.com/i;

const assertDirectUrls = (urls: string[], label = 'Media URL') => {
  for (const url of urls) {
    if (BLOCKED_DIRECT_URL.test(url)) {
      throw new PostifysApiError(
        `${label} cannot use Google Drive or Dropbox directly. Call postifys_media_upload first, then use serve_url.`,
        { code: 'POSTIFYS_MEDIA_PROXY_REQUIRED', statusCode: 400 },
      );
    }
  }
};

export const buildPublishBody = (args: Record<string, any>): { endpoint: string; body: Record<string, unknown> } => {
  const platform = args.platform as string;
  const asyncPublish = args.async !== false;

  if (platform === 'facebook') {
    // pageId is optional: the API falls back to the account's default Page.
    const pageId = String(args.accountId || '').trim();
    const text = String(args.text || '').trim();
    const mediaUrls = normalizeMediaUrls(args.mediaUrls);
    // Docs: type defaults based on payload -> IMAGE when media is present, FEED otherwise.
    const type = String(args.type || (mediaUrls.length ? 'IMAGE' : 'FEED')).toUpperCase();
    if (!text && !mediaUrls.length) {
      throw new PostifysApiError('Facebook posts require text or mediaUrls.', { code: 'VALIDATION', statusCode: 400 });
    }
    if (['IMAGE', 'REEL', 'VIDEO', 'STORIES'].includes(type) && !mediaUrls.length) {
      throw new PostifysApiError(`mediaUrls required for Facebook ${type}.`, { code: 'VALIDATION', statusCode: 400 });
    }
    assertDirectUrls(mediaUrls);
    const body: Record<string, unknown> = {
      ...(pageId ? { pageId } : {}),
      type: mediaUrls.length ? (type === 'VIDEO' ? 'REEL' : type === 'STORY' ? 'STORIES' : type) : 'FEED',
      text,
      mediaUrls,
      async: asyncPublish,
      proxyDownload: Boolean(args.proxyDownload),
    };
    if (args.collaborators) body.collaborators = args.collaborators;
    return { endpoint: '/api/facebook/post', body };
  }

  if (platform === 'instagram') {
    const instagramAccountId = String(args.accountId || '').trim();
    // Docs: IMAGE, VIDEO, REEL, or STORIES (alias STORY); default IMAGE.
    let type = String(args.type || 'IMAGE').toUpperCase();
    if (type === 'FEED') type = 'IMAGE';
    if (type === 'VIDEO' || type === 'REELS') type = 'REEL';
    if (type === 'STORY') type = 'STORIES';
    const text = String(args.text || '').trim();
    const mediaUrls = normalizeMediaUrls(args.mediaUrls);
    if (!mediaUrls.length) {
      throw new PostifysApiError('Instagram posts require mediaUrls.', { code: 'VALIDATION', statusCode: 400 });
    }
    assertDirectUrls(mediaUrls);
    const body: Record<string, unknown> = {
      ...(instagramAccountId ? { instagramAccountId } : {}),
      type,
      text,
      mediaUrls,
      async: asyncPublish,
      proxyDownload: Boolean(args.proxyDownload),
    };
    if (args.collaborators) body.collaborators = args.collaborators;
    return { endpoint: '/api/instagram/post', body };
  }

  if (platform === 'youtube') {
    const channelId = String(args.accountId || '').trim();
    const title = String(args.title || args.text || '').trim();
    const videoUrl = firstString(args.videoUrl, normalizeMediaUrls(args.mediaUrls)[0]);
    if (!title) throw new PostifysApiError('YouTube title is required.', { code: 'VALIDATION', statusCode: 400 });
    if (!videoUrl) throw new PostifysApiError('YouTube videoUrl is required.', { code: 'VALIDATION', statusCode: 400 });
    assertDirectUrls([videoUrl], 'videoUrl');
    if (args.thumbnailUrl) assertDirectUrls([String(args.thumbnailUrl)], 'thumbnailUrl');
    return {
      endpoint: '/api/youtube/post',
      body: {
        ...(channelId ? { channelId } : {}),
        title,
        description: args.description || '',
        videoUrl,
        thumbnailUrl: args.thumbnailUrl || '',
        privacyStatus: args.privacyStatus || 'private',
        tags: args.tags || '',
        categoryId: args.categoryId || '22',
        notifySubscribers: Boolean(args.notifySubscribers),
        async: asyncPublish,
      },
    };
  }

  if (platform === 'pinterest') {
    const pinterestUserId = String(args.accountId || '').trim();
    const boardId = String(args.boardId || '').trim();
    const title = String(args.title || args.text || '').trim();
    const imageUrl = firstString(args.imageUrl, normalizeMediaUrls(args.mediaUrls)[0]);
    if (!boardId) throw new PostifysApiError('boardId is required for Pinterest.', { code: 'VALIDATION', statusCode: 400 });
    if (!title) throw new PostifysApiError('Pinterest title is required.', { code: 'VALIDATION', statusCode: 400 });
    if (!imageUrl) throw new PostifysApiError('Pinterest imageUrl is required.', { code: 'VALIDATION', statusCode: 400 });
    assertDirectUrls([imageUrl], 'imageUrl');
    return {
      endpoint: '/api/pinterest/post',
      body: {
        ...(pinterestUserId ? { pinterestUserId } : {}),
        boardId,
        title,
        description: args.description || '',
        link: args.link || '',
        imageUrl,
        async: asyncPublish,
      },
    };
  }

  if (platform === 'linkedin') {
    const linkedinUserId = String(args.accountId || '').trim();
    const postType = String(args.type || args.postType || 'text').toLowerCase();
    const text = String(args.text || '').trim();
    if (!text) throw new PostifysApiError('LinkedIn text is required.', { code: 'VALIDATION', statusCode: 400 });
    const imageUrl = firstString(args.imageUrl, postType === 'image' ? normalizeMediaUrls(args.mediaUrls)[0] : '');
    const videoUrl = firstString(args.videoUrl, postType === 'video' ? normalizeMediaUrls(args.mediaUrls)[0] : '');
    if (postType === 'image' && !imageUrl) {
      throw new PostifysApiError('LinkedIn image posts require imageUrl.', { code: 'VALIDATION', statusCode: 400 });
    }
    if (postType === 'video' && !videoUrl) {
      throw new PostifysApiError('LinkedIn video posts require videoUrl.', { code: 'VALIDATION', statusCode: 400 });
    }
    if (imageUrl) assertDirectUrls([imageUrl], 'imageUrl');
    if (videoUrl) assertDirectUrls([videoUrl], 'videoUrl');
    return {
      endpoint: '/api/linkedin/post',
      body: {
        ...(linkedinUserId ? { linkedinUserId } : {}),
        postType,
        text,
        title: args.title || '',
        link: args.link || '',
        imageUrl,
        videoUrl,
        async: asyncPublish,
      },
    };
  }

  if (platform === 'tiktok') {
    const tiktokAccountId = String(args.accountId || '').trim();
    const postMode = String(args.postMode || 'inbox').toLowerCase() === 'direct' ? 'direct' : 'inbox';
    const videoUrl = firstString(args.videoUrl, normalizeMediaUrls(args.mediaUrls)[0]);
    const caption = String(args.caption || args.text || '').trim();
    const consent = Boolean(args.consent || args.musicUsageConfirmed);
    if (!videoUrl) throw new PostifysApiError('TikTok videoUrl is required.', { code: 'VALIDATION', statusCode: 400 });
    assertDirectUrls([videoUrl], 'videoUrl');
    if (postMode === 'direct' && !args.privacy) {
      throw new PostifysApiError('TikTok Direct Post requires privacy from postifys_tiktok_creator_info.', { code: 'VALIDATION', statusCode: 400 });
    }
    if (postMode === 'direct' && !consent) {
      throw new PostifysApiError('TikTok Direct Post requires consent and musicUsageConfirmed.', { code: 'VALIDATION', statusCode: 400 });
    }
    return {
      endpoint: '/api/tiktok/post',
      body: {
        ...(tiktokAccountId ? { tiktokAccountId } : {}),
        videoUrl,
        caption,
        privacy: args.privacy || 'SELF_ONLY',
        disableComment: args.allowComment === false,
        disableDuet: args.allowDuet === false,
        disableStitch: args.allowStitch === false,
        brandOrganicToggle: Boolean(args.brandOrganicToggle),
        brandContentToggle: Boolean(args.brandContentToggle),
        isAigc: Boolean(args.isAigc),
        postMode,
        consent,
        musicUsageConfirmed: consent,
        async: asyncPublish,
      },
    };
  }

  throw new PostifysApiError(`Unsupported platform: ${platform}`, { code: 'VALIDATION', statusCode: 400 });
};

export const summarizePublishResponse = (
  platform: string,
  data: Record<string, any>,
  idempotencyKey: string,
  asyncPublish: boolean,
) => {
  const postId = firstString(data.postId, data.postSubmissionId, data.historyId, data.id, data.data?.id, data.data?.postId);
  const syncPublished = !asyncPublish && data.success !== false && !data.accepted;
  if (!postId) {
    // The API accepted the request but did not return an id we can poll.
    return {
      success: true,
      platform,
      accepted: data.accepted ?? true,
      postId: null,
      status: syncPublished ? 'published' : (data.status || 'unknown'),
      shouldPoll: false,
      idempotencyKey,
      warning: 'Postifys did not return a postId. Do not re-publish blindly: check postifys_list_post_history (filter by platform) to find this post, or re-send with the same idempotencyKey.',
      raw: data,
    };
  }
  return {
    success: true,
    platform,
    accepted: data.accepted ?? true,
    postId,
    historyId: data.historyId || postId,
    status: syncPublished ? 'published' : (data.status || 'queued'),
    shouldPoll: !syncPublished,
    idempotencyKey,
    message: syncPublished
      ? 'Published synchronously.'
      : 'Call postifys_get_post_status with this postId until status is published or failed.',
    raw: data,
  };
};

export const registerPublishTools = (server: McpServer, client: PostifysClient) => {
  server.registerTool(
    'postifys_publish',
    {
      description: `Publish asynchronously to one platform. Always returns a postId to poll with postifys_get_post_status. Prefer Postifys serve_url media. ${HONEST_LIMITS}`,
      inputSchema: {
        platform: z.enum(['facebook', 'instagram', 'youtube', 'pinterest', 'linkedin', 'tiktok']),
        accountId: z.string().optional()
          .describe('Target account id from postifys_list_connections. Optional: when omitted the API uses your default/first connected account for that platform.'),
        text: z.string().optional().describe('Caption / message / LinkedIn text'),
        title: z.string().optional(),
        description: z.string().optional(),
        mediaUrls: z.union([z.string(), z.array(z.string())]).optional()
          .describe('CDN or Postifys serve_url values (not raw Drive/Dropbox)'),
        videoUrl: z.string().optional(),
        imageUrl: z.string().optional(),
        thumbnailUrl: z.string().optional(),
        type: z.string().optional()
          .describe('Post type. Facebook IMAGE|REEL|FEED|STORIES (default IMAGE with media, FEED without). Instagram IMAGE|REEL|STORIES (default IMAGE). LinkedIn text|image|video|link (default text).'),
        boardId: z.string().optional().describe('Required for Pinterest'),
        link: z.string().optional(),
        collaborators: z.string().optional().describe('FB Page IDs or IG usernames'),
        privacyStatus: z.enum(['private', 'unlisted', 'public']).optional(),
        tags: z.string().optional(),
        categoryId: z.string().optional(),
        notifySubscribers: z.boolean().optional(),
        postMode: z.enum(['direct', 'inbox']).optional().describe('TikTok: prefer inbox unless Direct Post approved'),
        privacy: z.string().optional().describe('TikTok privacy from creator_info'),
        caption: z.string().optional(),
        consent: z.boolean().optional(),
        musicUsageConfirmed: z.boolean().optional(),
        allowComment: z.boolean().optional(),
        allowDuet: z.boolean().optional(),
        allowStitch: z.boolean().optional(),
        brandOrganicToggle: z.boolean().optional(),
        brandContentToggle: z.boolean().optional(),
        isAigc: z.boolean().optional(),
        proxyDownload: z.boolean().optional(),
        async: z.boolean().optional().describe('Default true'),
        idempotencyKey: z.string().optional()
          .describe('Optional. One is auto-generated per call so transient 429/5xx failures can be retried without double-posting.'),
      },
    },
    async (args) => {
      try {
        const { endpoint, body } = buildPublishBody(args);
        const idempotencyKey = String(args.idempotencyKey || '').trim() || newIdempotencyKey();
        const data = await client.request<Record<string, unknown>>({
          path: endpoint,
          method: 'POST',
          body,
          headers: { 'Idempotency-Key': idempotencyKey },
        });
        return toolResult(summarizePublishResponse(args.platform, data, idempotencyKey, body.async !== false));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'postifys_get_post_status',
    {
      description: 'Poll async publish status by postId until published/failed/partial.',
      inputSchema: {
        postId: z.string().min(1),
        platform: z.enum(['facebook', 'instagram', 'youtube', 'pinterest', 'linkedin', 'tiktok']).optional(),
      },
    },
    async ({ postId, platform }) => {
      try {
        const data = await client.request<Record<string, unknown>>({
          path: '/api/posts/status',
          query: { postId, platform },
        });
        const status = firstString(data.status).toLowerCase();
        const terminal = ['published', 'failed', 'partial', 'cancelled', 'skipped'].includes(status);
        return toolResult({
          success: true,
          postId,
          status: data.status,
          stage: data.stage,
          isComplete: terminal,
          shouldPoll: !terminal,
          published: status === 'published',
          failed: status === 'failed',
          failureReason: data.failureReason || data.error || null,
          data,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'postifys_list_post_history',
    {
      description: 'List recent publish history (newest first) with status and failure reasons. Use it to find failed posts to retry, or to locate a post when publish returned no postId.',
      inputSchema: {
        status: z.enum(['all', 'failed', 'published', 'pending', 'queued', 'processing', 'active']).optional(),
        platform: z.enum(['facebook', 'instagram', 'youtube', 'pinterest', 'linkedin', 'tiktok']).optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional().describe('Page size (default 20, max 100)'),
      },
    },
    async ({ status, platform, page, limit }) => {
      try {
        const data = await client.request<Record<string, any>>({
          path: '/api/posts/history',
          query: { status, platform, page, limit },
        });
        return toolResult({ success: true, ...data });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'postifys_retry_post',
    {
      description: 'Retry a failed post by its postId/historyId (only status=failed posts can be retried). Returns a new postId to poll with postifys_get_post_status.',
      inputSchema: {
        postId: z.string().min(1),
      },
    },
    async ({ postId }) => {
      try {
        // Retry creates a new submission and the endpoint has no idempotency
        // support, so it is never auto-retried on 429/5xx.
        const data = await client.request<Record<string, any>>({
          path: `/api/posts/${encodeURIComponent(postId)}/retry`,
          method: 'POST',
          body: {},
          retry: false,
        });
        const newPostId = firstString(data.postId, data.postSubmissionId, data.historyId);
        return toolResult({
          success: true,
          retriedPostId: postId,
          postId: newPostId || null,
          status: data.status || 'queued',
          shouldPoll: Boolean(newPostId),
          ...(newPostId ? {} : { warning: 'No new postId returned; check postifys_list_post_history.' }),
          raw: data,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
};
