#!/usr/bin/env node
/**
 * Non-MCP smoke: hits production (or POSTIFYS_SERVER_URL) with POSTIFYS_API_KEY.
 * Usage: POSTIFYS_API_KEY=... npm run smoke
 *
 * Set POSTIFYS_SMOKE_PUBLISH=1 to also attempt a safe LinkedIn text post (async) if a connection exists.
 */
import { PostifysClient, loadConfig } from './client.js';

async function main() {
  const client = new PostifysClient(loadConfig());
  console.log('server:', client.config.serverUrl);

  const ping = await client.request({ path: '/api/key/test' });
  console.log('ping:', JSON.stringify(ping));

  const connections = await client.request<{ connections?: any[] }>({ path: '/api/connections' });
  const list = Array.isArray(connections.connections) ? connections.connections : [];
  console.log('connections:', list.length);
  const byPlatform = list.reduce<Record<string, number>>((acc, c) => {
    const p = String(c.platform || c.type || 'unknown').toLowerCase();
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});
  console.log('byPlatform:', byPlatform);

  // Media: small public sample image
  const sampleUrl = 'https://postifys.com/assets/postify-plus-logo-1024.png';
  const queued = await client.request<any>({
    path: '/api/media/queue',
    method: 'POST',
    body: { url: sampleUrl, filename: 'mcp-smoke-logo.png' },
  });
  const mediaJobId = queued.mediaJobId || queued.jobId || queued.id;
  console.log('media queued:', mediaJobId);

  let serveUrl: string | undefined;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const status = await client.request<any>({
      path: '/api/media/status',
      query: { mediaJobId },
    });
    const st = String(status.status || status.state || '').toLowerCase();
    serveUrl = status.serve_url || status.serveUrl || status.url;
    console.log('media status:', st || 'unknown', serveUrl ? 'has serve_url' : '');
    if (serveUrl || st === 'ready' || st === 'completed' || st === 'failed' || st === 'error') {
      if (st === 'failed' || st === 'error') {
        throw new Error(`media failed: ${JSON.stringify(status)}`);
      }
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!serveUrl) {
    console.warn('media still pending after timeout; continuing with CQ smoke');
  } else {
    console.log('serve_url:', serveUrl);
  }

  // Content Queue: create table + pending item (no job run)
  const tableName = `mcp-smoke-${Date.now()}`;
  const tableRes = await client.request<any>({
    path: '/api/content-queue/tables',
    method: 'POST',
    body: { name: tableName },
  });
  const tableId = tableRes.table?.id || tableRes.id || tableRes.tableId;
  console.log('cq table:', tableId, tableName);

  if (tableId) {
    const itemRes = await client.request<any>({
      path: `/api/content-queue/tables/${encodeURIComponent(tableId)}/items`,
      method: 'POST',
      body: {
        title: 'MCP smoke item',
        path: serveUrl || sampleUrl,
        description: 'Created by postifys-mcp smoke — do not auto-publish',
        status: 'pending',
      },
    });
    console.log('cq item:', itemRes.item?.id || itemRes.id || 'ok');
  }

  if (process.env.POSTIFYS_SMOKE_PUBLISH === '1') {
    const li = list.find((c) => String(c.platform || '').toLowerCase() === 'linkedin');
    if (!li) {
      console.log('publish skip: no linkedin connection');
    } else {
      const accountId = li.id || li.accountId || li.urn;
      const pub = await client.request<any>({
        path: '/api/linkedin/post',
        method: 'POST',
        body: {
          text: `Postifys MCP smoke ${new Date().toISOString()} — safe text check`,
          accountId,
          async: true,
        },
        headers: { 'Idempotency-Key': `mcp-smoke-${Date.now()}` },
      });
      const postId = pub.postId || pub.id;
      console.log('publish queued:', postId, pub.status || pub);
      if (postId) {
        const st = await client.request({ path: '/api/posts/status', query: { postId } });
        console.log('post status:', JSON.stringify(st));
      }
    }
  } else {
    console.log('publish: skipped (set POSTIFYS_SMOKE_PUBLISH=1 to enable)');
  }

  // Negative: bad key
  try {
    const bad = new PostifysClient({
      apiKey: 'pfs_invalid_smoke',
      serverUrl: client.config.serverUrl,
    });
    await bad.request({ path: '/api/key/test' });
    console.warn('negative: expected bad key to fail');
  } catch (error: any) {
    console.log('negative bad key:', error.code || error.status || error.message);
  }

  console.log('smoke ok');
}

main().catch((error) => {
  console.error('smoke failed:', error);
  process.exit(1);
});
