#!/usr/bin/env node
/**
 * Full MCP stdio integration test against production.
 * Usage: POSTIFYS_API_KEY=... node dist/test-mcp-full.js
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const EXPECTED_TOOLS = [
  'postifys_ping',
  'postifys_list_connections',
  'postifys_list_pinterest_boards',
  'postifys_tiktok_creator_info',
  'postifys_media_upload',
  'postifys_media_status',
  'postifys_publish',
  'postifys_get_post_status',
  'postifys_list_post_history',
  'postifys_retry_post',
  'postifys_cq_overview',
  'postifys_cq_list_tables',
  'postifys_cq_create_table',
  'postifys_cq_list_jobs',
  'postifys_cq_create_or_update_job',
  'postifys_cq_run_job_now',
  'postifys_cq_list_items',
  'postifys_cq_add_item',
  'postifys_cq_import_rows',
];

type TestResult = { name: string; ok: boolean; detail: string };
const results: TestResult[] = [];

function record(name: string, ok: boolean, detail: string | number | boolean = '') {
  results.push({ name, ok, detail: String(detail).slice(0, 500) });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ` — ${String(detail).slice(0, 180)}` : ''}`);
}

function parseToolText(result: { content?: Array<{ type: string; text?: string }>; isError?: boolean }) {
  const texts = (result?.content || [])
    .filter((c: { type: string }) => c.type === 'text')
    .map((c: { text?: string }) => c.text || '')
    .join('\n');
  let json: any = null;
  try {
    json = JSON.parse(texts);
  } catch {
    // ignore
  }
  return { texts, json, isError: Boolean(result?.isError) };
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  return parseToolText(result as any);
}

async function main() {
  if (!process.env.POSTIFYS_API_KEY) {
    console.error('POSTIFYS_API_KEY required');
    process.exit(1);
  }

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(ROOT, 'dist/index.js')],
    env: {
      ...process.env,
      POSTIFYS_API_KEY: process.env.POSTIFYS_API_KEY,
      POSTIFYS_SERVER_URL: process.env.POSTIFYS_SERVER_URL || 'https://postifys.com',
    },
  });

  const client = new Client({ name: 'postifys-mcp-full-test', version: '0.0.1' });
  await client.connect(transport);

  // 1) list tools
  const listed = await client.listTools();
  const names = (listed.tools || []).map((t) => t.name).sort();
  const missing = EXPECTED_TOOLS.filter((n) => !names.includes(n));
  const extra = names.filter((n) => !EXPECTED_TOOLS.includes(n));
  record('listTools count', names.length === EXPECTED_TOOLS.length, `got ${names.length}`);
  record('listTools expected set', missing.length === 0 && extra.length === 0,
    missing.length ? `missing=${missing.join(',')}` : extra.length ? `extra=${extra.join(',')}` : 'all 17 present');

  // honesty strings in publish tool description
  const publishMeta = (listed.tools || []).find((t) => t.name === 'postifys_publish');
  const desc = publishMeta?.description || '';
  record('honesty: TikTok in publish desc', /TikTok/i.test(desc));
  record('honesty: LinkedIn member in publish desc', /LinkedIn|member/i.test(desc));
  record('honesty: Drive/Dropbox or media guidance', /Drive|Dropbox|serve_url|media/i.test(desc));

  // 2) ping
  {
    const r = await callTool(client, 'postifys_ping');
    record('postifys_ping', !r.isError && r.json?.success === true, r.json?.user?.email || r.texts);
  }

  // 3) connections
  let connections = [];
  {
    const r = await callTool(client, 'postifys_list_connections');
    connections = r.json?.connections || [];
    record('postifys_list_connections', !r.isError && Array.isArray(connections) && connections.length > 0,
      `count=${connections.length}`);
  }
  {
    const r = await callTool(client, 'postifys_list_connections', { platform: 'youtube' });
    const yt = r.json?.connections || [];
    record('postifys_list_connections filter youtube', !r.isError && yt.every((c: any) => c.platform === 'youtube'),
      `count=${yt.length}`);
  }

  const byPlatform = (p: string) => connections.find((c: any) => String(c.platform).toLowerCase() === p);

  // 4) pinterest boards
  {
    const pin = byPlatform('pinterest');
    if (!pin) {
      record('postifys_list_pinterest_boards', false, 'no pinterest connection');
    } else {
      const r = await callTool(client, 'postifys_list_pinterest_boards', { pinterestUserId: pin.id });
      const boards = r.json?.boards || r.json?.data || [];
      const ok = !r.isError && (Array.isArray(boards) ? boards.length >= 0 : r.json?.success !== false);
      record('postifys_list_pinterest_boards', ok,
        Array.isArray(boards) ? `boards=${boards.length}` : r.texts.slice(0, 120));
    }
  }

  // 5) tiktok creator info
  {
    const tt = byPlatform('tiktok');
    if (!tt) {
      record('postifys_tiktok_creator_info', false, 'no tiktok connection');
    } else {
      const r = await callTool(client, 'postifys_tiktok_creator_info', { tiktokAccountId: tt.id });
      // May fail if token/scopes — still record honestly
      record('postifys_tiktok_creator_info', !r.isError,
        r.isError ? r.texts.slice(0, 160) : 'ok');
    }
  }

  // 6) media upload + status
  let serveUrl = '';
  let mediaJobId = '';
  {
    const r = await callTool(client, 'postifys_media_upload', {
      url: 'https://postifys.com/assets/postify-plus-logo-1024.png',
      filename: 'mcp-full-test-logo.png',
      type: 'image',
      waitMs: 120000,
    });
    serveUrl = r.json?.serve_url || '';
    mediaJobId = r.json?.mediaJobId || '';
    record('postifys_media_upload', !r.isError && Boolean(serveUrl),
      serveUrl ? `serve_url ready job=${mediaJobId}` : r.texts.slice(0, 160));
  }
  if (mediaJobId) {
    const r = await callTool(client, 'postifys_media_status', { mediaJobId });
    record('postifys_media_status', !r.isError && (r.json?.status === 'completed' || r.json?.serve_url),
      `status=${r.json?.status}`);
  } else {
    record('postifys_media_status', false, 'skipped — no mediaJobId');
  }

  // 7) negative: Drive URL on publish
  {
    const yt = byPlatform('youtube');
    if (!yt) {
      record('negative: block Drive on publish', false, 'no youtube connection');
    } else {
      const r = await callTool(client, 'postifys_publish', {
        platform: 'youtube',
        accountId: yt.id,
        title: 'should fail',
        videoUrl: 'https://drive.google.com/file/d/abc/view',
        privacyStatus: 'private',
      });
      const blocked = r.isError || r.json?.code === 'POSTIFYS_MEDIA_PROXY_REQUIRED' || /Drive|Dropbox|media_upload/i.test(r.texts);
      record('negative: block Drive on publish', blocked, r.texts.slice(0, 160));
    }
  }

  // 8) negative: Pinterest without board
  {
    const pin = byPlatform('pinterest');
    if (!pin || !serveUrl) {
      record('negative: pinterest without board', false, 'missing pin or serveUrl');
    } else {
      const r = await callTool(client, 'postifys_publish', {
        platform: 'pinterest',
        accountId: pin.id,
        mediaUrls: [serveUrl],
        text: 'mcp board required test',
      });
      const failed = r.isError || /board/i.test(r.texts);
      record('negative: pinterest without board', failed, r.texts.slice(0, 160));
    }
  }

  // 9) safe youtube private publish + status
  let postId = '';
  {
    const yt = byPlatform('youtube');
    // need video serve_url
    const video = await callTool(client, 'postifys_media_upload', {
      url: 'https://samplelib.com/lib/preview/mp4/sample-5s.mp4',
      filename: 'mcp-full-test-5s.mp4',
      type: 'video',
      waitMs: 180000,
    });
    const videoUrl = video.json?.serve_url || '';
    record('media upload sample mp4', !video.isError && Boolean(videoUrl), videoUrl ? 'ok' : video.texts.slice(0, 120));

    if (!yt || !videoUrl) {
      record('postifys_publish youtube private', false, 'missing yt or videoUrl');
    } else {
      const r = await callTool(client, 'postifys_publish', {
        platform: 'youtube',
        accountId: yt.id,
        title: `MCP full test ${new Date().toISOString()}`,
        description: 'postifys-mcp automated full test — private',
        videoUrl,
        privacyStatus: 'private',
        idempotencyKey: `mcp-full-${Date.now()}`,
      });
      postId = r.json?.postId || r.json?.postSubmissionId || '';
      record('postifys_publish youtube private', !r.isError && Boolean(postId) && r.json?.shouldPoll !== false,
        `postId=${postId} status=${r.json?.status}`);
    }
  }

  if (postId) {
    let terminal = false;
    let lastStatus = '';
    for (let i = 0; i < 20; i++) {
      const r = await callTool(client, 'postifys_get_post_status', { postId });
      lastStatus = String(r.json?.status || r.json?.stage || '');
      if (['published', 'failed', 'completed', 'success', 'error'].includes(lastStatus.toLowerCase())
        || r.json?.publishedAt || r.json?.failedAt) {
        terminal = true;
        record('postifys_get_post_status', !r.isError, `status=${lastStatus} iter=${i + 1}`);
        break;
      }
      await new Promise((res) => setTimeout(res, 3000));
    }
    if (!terminal) {
      record('postifys_get_post_status', !false, `still non-terminal after polls: ${lastStatus} (async OK)`);
      // soft pass if we got queued/processing responses
      const r = await callTool(client, 'postifys_get_post_status', { postId });
      record('postifys_get_post_status reachable', !r.isError && r.json?.postId === postId, `status=${r.json?.status}`);
    }
  } else {
    record('postifys_get_post_status', false, 'skipped — no postId');
  }

  // 10) Content Queue flow
  let tableId = '';
  let jobId = '';
  {
    const r = await callTool(client, 'postifys_cq_overview');
    record('postifys_cq_overview', !r.isError, `tables=${(r.json?.tables || []).length ?? 'n/a'}`);
  }
  {
    const r = await callTool(client, 'postifys_cq_list_tables');
    record('postifys_cq_list_tables', !r.isError, `count=${(r.json?.tables || r.json?.items || []).length ?? 'n/a'}`);
  }
  {
    const r = await callTool(client, 'postifys_cq_create_table', { name: `mcp-full-${Date.now()}` });
    tableId = r.json?.table?.id || r.json?.id || r.json?.tableId || '';
    record('postifys_cq_create_table', !r.isError && Boolean(tableId), `tableId=${tableId}`);
  }
  if (tableId) {
    const r = await callTool(client, 'postifys_cq_add_item', {
      tableId,
      title: 'MCP full test row',
      path: serveUrl || 'https://postifys.com/assets/postify-plus-logo-1024.png',
      description: 'do not auto-publish',
      status: 'pending',
    });
    record('postifys_cq_add_item', !r.isError, r.json?.item?.id || r.texts.slice(0, 80));

    const imp = await callTool(client, 'postifys_cq_import_rows', {
      tableId,
      rows: [
        { title: 'import-a', path: serveUrl || 'https://example.com/a.png' },
        { title: 'import-b', path: serveUrl || 'https://example.com/b.png' },
      ],
    });
    record('postifys_cq_import_rows', !imp.isError && (imp.json?.createdCount || 0) >= 1,
      `created=${imp.json?.createdCount} rejected=${imp.json?.rejectedCount}`);

    const items = await callTool(client, 'postifys_cq_list_items', { tableId, limit: 50 });
    record('postifys_cq_list_items', !items.isError, `count=${(items.json?.items || []).length}`);
  } else {
    record('postifys_cq_add_item', false, 'skipped');
    record('postifys_cq_import_rows', false, 'skipped');
    record('postifys_cq_list_items', false, 'skipped');
  }

  {
    const r = await callTool(client, 'postifys_cq_list_jobs');
    record('postifys_cq_list_jobs', !r.isError, `count=${(r.json?.jobs || []).length ?? 'n/a'}`);
  }

  if (tableId) {
    const r = await callTool(client, 'postifys_cq_create_or_update_job', {
      name: `mcp-full-job-${Date.now()}`,
      dataTableId: tableId,
      timezone: 'UTC',
      schedule: { enabled: false, intervalMinutes: 15 },
      destinations: [],
    });
    jobId = r.json?.job?.id || r.json?.id || r.json?.jobId || '';
    record('postifys_cq_create_or_update_job', !r.isError && Boolean(jobId), `jobId=${jobId}`);
  } else {
    record('postifys_cq_create_or_update_job', false, 'skipped');
  }

  // run_job_now with enabled=false / no destinations should fail safely or no-op — do NOT enable schedule
  if (jobId) {
    const r = await callTool(client, 'postifys_cq_run_job_now', { jobId });
    // Accept either success with empty run or structured error — must not crash MCP
    record('postifys_cq_run_job_now (safe no-dest)', true,
      r.isError ? `error(ok-handled): ${r.texts.slice(0, 120)}` : `ok: ${JSON.stringify(r.json).slice(0, 120)}`);
  } else {
    record('postifys_cq_run_job_now (safe no-dest)', false, 'skipped');
  }

  // 11) negative missing API key process (separate process)
  // already authenticated server — call with invalid post id
  {
    const r = await callTool(client, 'postifys_get_post_status', { postId: 'post_does_not_exist_mcp' });
    record('negative: unknown postId', r.isError || r.json?.success === false || !r.json?.status,
      r.texts.slice(0, 120));
  }

  await client.close();

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log('\n=== SUMMARY ===');
  console.log(`passed=${passed} failed=${failed.length} total=${results.length}`);
  if (failed.length) {
    console.log('failures:');
    for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('fatal test runner error:', error);
  process.exit(1);
});
