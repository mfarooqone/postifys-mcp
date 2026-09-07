import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PostifysApiError, PostifysClient, firstString, toolError, toolResult } from '../client.js';
import { HONEST_LIMITS } from '../honesty.js';

const MEDIA_UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const MEDIA_STATUS_POLL_INTERVAL_MS = 3_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const uploadedMediaUrl = (response: Record<string, unknown>): string => firstString(
  response.url,
  response.media_url,
  response.mediaUrl,
  response.serve_url,
  response.serveUrl,
  response.direct_url,
  response.directUrl,
  (response.data as Record<string, unknown> | undefined)?.url,
  (response.data as Record<string, unknown> | undefined)?.serve_url,
);

export const registerMediaTools = (server: McpServer, client: PostifysClient) => {
  server.registerTool(
    'postifys_media_upload',
    {
      description: `Queue a source URL for download/proxy on Postifys and poll until a public serve_url is ready. Use this before publish for Google Drive, Dropbox, or any non-CDN URL. ${HONEST_LIMITS}`,
      inputSchema: {
        url: z.string().url().describe('Source media URL (Drive share links OK here)'),
        filename: z.string().optional().describe('Optional filename hint'),
        type: z.enum(['any', 'image', 'video']).optional().describe('Media type hint (default any)'),
        waitMs: z.number().int().min(5_000).max(MEDIA_UPLOAD_TIMEOUT_MS).optional()
          .describe('Max wait for completion (default 300000)'),
      },
    },
    async ({ url, filename, type, waitMs }) => {
      try {
        const queued = await client.request<Record<string, unknown>>({
          path: '/api/media/queue',
          method: 'POST',
          body: {
            url,
            type: type || 'any',
            ...(filename ? { filename } : {}),
          },
        });

        const mediaJobId = firstString(queued.mediaJobId, queued.jobId, queued.id);
        if (!mediaJobId) {
          throw new PostifysApiError('Postifys media queue did not return a mediaJobId.', {
            code: 'POSTIFYS_MEDIA_JOB_MISSING',
          });
        }

        const deadline = Date.now() + (waitMs || MEDIA_UPLOAD_TIMEOUT_MS);
        let latest = queued;
        while (Date.now() < deadline) {
          const status = firstString(latest.status).toLowerCase();
          if (status === 'completed') {
            const serveUrl = uploadedMediaUrl(latest);
            if (!serveUrl) {
              throw new PostifysApiError('Media job completed without a serve_url.', {
                code: 'POSTIFYS_MEDIA_URL_MISSING',
              });
            }
            return toolResult({
              success: true,
              mediaJobId,
              status: 'completed',
              serve_url: serveUrl,
              name: firstString(latest.name, latest.filename, latest.file_name),
            });
          }
          if (status === 'failed') {
            throw new PostifysApiError(
              firstString(latest.failureReason, latest.error, latest.message) || 'Media upload failed.',
              { code: 'POSTIFYS_MEDIA_FAILED', details: latest },
            );
          }
          await sleep(MEDIA_STATUS_POLL_INTERVAL_MS);
          latest = await client.request<Record<string, unknown>>({
            path: '/api/media/status',
            query: { mediaJobId },
          });
        }

        return toolResult({
          success: false,
          pending: true,
          mediaJobId,
          status: latest.status || 'processing',
          message: 'Media still processing. Call postifys_media_status with this mediaJobId.',
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'postifys_media_status',
    {
      description: 'Poll a Postifys media job by mediaJobId.',
      inputSchema: {
        mediaJobId: z.string().min(1),
      },
    },
    async ({ mediaJobId }) => {
      try {
        const latest = await client.request<Record<string, unknown>>({
          path: '/api/media/status',
          query: { mediaJobId },
        });
        return toolResult({
          success: true,
          mediaJobId,
          status: latest.status,
          serve_url: uploadedMediaUrl(latest) || null,
          failureReason: latest.failureReason || null,
          raw: latest,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
};
