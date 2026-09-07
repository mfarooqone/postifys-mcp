import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PostifysClient, toolError, toolResult } from '../client.js';
import { HONEST_LIMITS } from '../honesty.js';

export const registerDiscoveryTools = (server: McpServer, client: PostifysClient) => {
  server.registerTool(
    'postifys_ping',
    {
      description: `Test the Postifys API key against the configured server. ${HONEST_LIMITS}`,
      inputSchema: {},
    },
    async () => {
      try {
        const data = await client.request({ path: '/api/key/test' });
        return toolResult({ success: true, serverUrl: client.config.serverUrl, ...data });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'postifys_list_connections',
    {
      description: `List connected social accounts for publishing. Use returned id fields as account targets (pageId, instagramAccountId, channelId, etc.). Filter with platform when helpful. ${HONEST_LIMITS}`,
      inputSchema: {
        platform: z.enum(['facebook', 'instagram', 'youtube', 'pinterest', 'linkedin', 'tiktok']).optional()
          .describe('Optional platform filter'),
      },
    },
    async ({ platform }) => {
      try {
        const data = await client.request<{ connections?: any[]; metaAccounts?: any[] }>({
          path: '/api/connections',
        });
        let connections = Array.isArray(data.connections) ? data.connections : [];
        if (platform) {
          connections = connections.filter((item) => String(item.platform || '').toLowerCase() === platform);
        }
        return toolResult({
          success: true,
          count: connections.length,
          connections: connections.map((item) => ({
            id: item.id,
            platform: item.platform,
            name: item.name,
            username: item.username,
            status: item.status,
            avatar_url: item.avatar_url,
          })),
          metaAccounts: data.metaAccounts,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'postifys_list_pinterest_boards',
    {
      description: 'List Pinterest boards for a connected Pinterest account. boardId is required when publishing image Pins.',
      inputSchema: {
        pinterestUserId: z.string().min(1).describe('Pinterest account id from postifys_list_connections'),
      },
    },
    async ({ pinterestUserId }) => {
      try {
        const data = await client.request({
          path: '/api/pinterest/boards',
          query: { pinterestUserId },
        });
        return toolResult({ success: true, ...data });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'postifys_tiktok_creator_info',
    {
      description: 'Fetch TikTok creator publish options (privacy levels, interactions). Call before Direct Post.',
      inputSchema: {
        tiktokAccountId: z.string().min(1).describe('TikTok account id from postifys_list_connections'),
      },
    },
    async ({ tiktokAccountId }) => {
      try {
        const data = await client.request({
          path: '/api/tiktok/creator-info',
          query: { tiktokAccountId },
        });
        return toolResult({ success: true, ...data });
      } catch (error) {
        return toolError(error);
      }
    },
  );
};
