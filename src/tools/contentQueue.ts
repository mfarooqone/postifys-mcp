import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PostifysClient, toolError, toolResult } from '../client.js';
import { CQ_DESCRIPTION, HONEST_LIMITS } from '../honesty.js';

export const registerContentQueueTools = (server: McpServer, client: PostifysClient) => {
  server.registerTool(
    'postifys_cq_overview',
    {
      description: `${CQ_DESCRIPTION} Returns tables, jobs, and next-run hints. ${HONEST_LIMITS}`,
      inputSchema: {},
    },
    async () => {
      try {
        const data = await client.request({ path: '/api/content-queue' });
        return toolResult({ success: true, ...data });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'postifys_cq_list_tables',
    {
      description: `${CQ_DESCRIPTION} List data tables.`,
      inputSchema: {},
    },
    async () => {
      try {
        const data = await client.request({ path: '/api/content-queue/tables' });
        return toolResult({ success: true, ...data });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'postifys_cq_create_table',
    {
      description: `${CQ_DESCRIPTION} Create a data table for queue rows.`,
      inputSchema: {
        name: z.string().min(1).max(120),
      },
    },
    async ({ name }) => {
      try {
        const data = await client.request({
          path: '/api/content-queue/tables',
          method: 'POST',
          body: { name },
        });
        return toolResult({ success: true, ...data });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'postifys_cq_list_jobs',
    {
      description: `${CQ_DESCRIPTION} List publishing jobs (one job per table).`,
      inputSchema: {},
    },
    async () => {
      try {
        const data = await client.request({ path: '/api/content-queue/jobs' });
        return toolResult({ success: true, ...data });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'postifys_cq_create_or_update_job',
    {
      description: `${CQ_DESCRIPTION} Create a job (omit jobId) or update (pass jobId). Interval must be ≥ 15 minutes. Keep schedule.enabled false until destinations are ready.`,
      inputSchema: {
        jobId: z.string().optional().describe('If set, updates existing job via PUT'),
        name: z.string().optional(),
        dataTableId: z.string().optional().describe('Required when creating'),
        timezone: z.string().optional(),
        schedule: z.object({
          enabled: z.boolean().optional(),
          intervalMinutes: z.number().int().min(15).max(10080).optional(),
          daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
          activeHoursStart: z.string().nullable().optional(),
          activeHoursEnd: z.string().nullable().optional(),
        }).optional(),
        destinations: z.array(z.object({
          platform: z.string(),
          targetId: z.string(),
          targetName: z.string().optional(),
          enabled: z.boolean().optional(),
          settings: z.record(z.unknown()).optional(),
        })).optional(),
        defaults: z.record(z.unknown()).optional(),
      },
    },
    async (args) => {
      try {
        const body: Record<string, unknown> = {};
        if (args.name !== undefined) body.name = args.name;
        if (args.dataTableId !== undefined) body.dataTableId = args.dataTableId;
        if (args.timezone !== undefined) body.timezone = args.timezone;
        if (args.schedule !== undefined) body.schedule = args.schedule;
        if (args.destinations !== undefined) body.destinations = args.destinations;
        if (args.defaults !== undefined) body.defaults = args.defaults;

        const data = args.jobId
          ? await client.request({
            path: `/api/content-queue/jobs/${encodeURIComponent(args.jobId)}`,
            method: 'PUT',
            body,
          })
          : await client.request({
            path: '/api/content-queue/jobs',
            method: 'POST',
            body,
          });
        return toolResult({ success: true, ...data });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'postifys_cq_run_job_now',
    {
      description: `${CQ_DESCRIPTION} Trigger the next eligible pending row for a job immediately.`,
      inputSchema: {
        jobId: z.string().min(1),
      },
    },
    async ({ jobId }) => {
      try {
        const data = await client.request({
          path: `/api/content-queue/jobs/${encodeURIComponent(jobId)}/run-now`,
          method: 'POST',
          body: {},
        });
        return toolResult({ success: true, ...data });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'postifys_cq_list_items',
    {
      description: `${CQ_DESCRIPTION} List rows in a data table.`,
      inputSchema: {
        tableId: z.string().min(1),
        status: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    async ({ tableId, status, limit }) => {
      try {
        const data = await client.request({
          path: `/api/content-queue/tables/${encodeURIComponent(tableId)}/items`,
          query: { status, limit },
        });
        return toolResult({ success: true, ...data });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'postifys_cq_add_item',
    {
      description: `${CQ_DESCRIPTION} Add a pending row. path may be a Drive share URL (resolved at publish time).`,
      inputSchema: {
        tableId: z.string().min(1),
        title: z.string().min(1),
        path: z.string().min(1).describe('Media URL or Drive share link'),
        description: z.string().optional(),
        hashtags: z.string().optional(),
        postType: z.enum(['VIDEO', 'IMAGE', 'STORIES', 'FEED', 'REEL']).optional(),
        status: z.enum(['pending']).optional(),
      },
    },
    async ({ tableId, title, path, description, hashtags, postType, status }) => {
      try {
        const data = await client.request({
          path: `/api/content-queue/tables/${encodeURIComponent(tableId)}/items`,
          method: 'POST',
          body: {
            title,
            path,
            description,
            hashtags,
            postType,
            status: status || 'pending',
          },
        });
        return toolResult({ success: true, ...data });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'postifys_cq_import_rows',
    {
      description: `${CQ_DESCRIPTION} Bulk-import pending rows into a table (JSON rows, not multipart CSV).`,
      inputSchema: {
        tableId: z.string().min(1),
        rows: z.array(z.object({
          title: z.string().min(1),
          path: z.string().min(1),
          description: z.string().optional(),
          hashtags: z.string().optional(),
          postType: z.string().optional(),
          status: z.string().optional(),
        })).min(1).max(500),
      },
    },
    async ({ tableId, rows }) => {
      try {
        // Prefer items append endpoint when import expects CSV; fall back to sequential create.
        const created = [];
        const rejected = [];
        for (const row of rows) {
          try {
            const data = await client.request<any>({
              path: `/api/content-queue/tables/${encodeURIComponent(tableId)}/items`,
              method: 'POST',
              body: { ...row, status: row.status || 'pending' },
            });
            created.push(data.item || data);
          } catch (error: any) {
            rejected.push({
              title: row.title,
              error: error?.message || 'failed',
              code: error?.code,
            });
          }
        }
        return toolResult({
          success: true,
          createdCount: created.length,
          rejectedCount: rejected.length,
          created,
          rejected,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
};
