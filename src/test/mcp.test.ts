/**
 * Offline MCP tests: spawns the built stdio server against a local mock
 * Postifys API. No network or real API key needed.
 * Run: npm run test:mcp
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildPublishBody, summarizePublishResponse } from '../tools/publish.js';
import { PostifysClient } from '../client.js';

type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: any };

const startMock = async (handler: (req: Seen, res: http.ServerResponse) => void) => {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const entry: Seen = { method: req.method || '', url: req.url || '', headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
      seen.push(entry);
      handler(entry, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, url, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
};

const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

const connect = async (serverUrl: string, extraEnv: Record<string, string> = {}) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL('../index.js', import.meta.url).pathname],
    env: {
      PATH: process.env.PATH || '',
      POSTIFYS_API_KEY: 'pfs_test',
      POSTIFYS_SERVER_URL: serverUrl,
      POSTIFYS_RETRY_BASE_MS: '1',
      ...extraEnv,
    },
  });
  const client = new Client({ name: 'postifys-mcp-test', version: '0.0.0' });
  await client.connect(transport);
  return client;
};

const callJson = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result: any = await client.callTool({ name, arguments: args });
  return { isError: Boolean(result.isError), json: JSON.parse(result.content[0].text) };
};

test('FB/IG default types match the docs', () => {
  assert.equal(buildPublishBody({ platform: 'facebook', mediaUrls: ['https://cdn/x.jpg'] }).body.type, 'IMAGE');
  assert.equal(buildPublishBody({ platform: 'facebook', text: 'hi' }).body.type, 'FEED');
  assert.equal(buildPublishBody({ platform: 'facebook', type: 'video', mediaUrls: ['https://cdn/x.mp4'] }).body.type, 'REEL');
  assert.equal(buildPublishBody({ platform: 'instagram', mediaUrls: ['https://cdn/x.jpg'] }).body.type, 'IMAGE');
  assert.equal(buildPublishBody({ platform: 'instagram', type: 'FEED', mediaUrls: ['https://cdn/x.jpg'] }).body.type, 'IMAGE');
  assert.equal(buildPublishBody({ platform: 'instagram', type: 'video', mediaUrls: ['https://cdn/x.mp4'] }).body.type, 'REEL');
  assert.equal(buildPublishBody({ platform: 'instagram', type: 'story', mediaUrls: ['https://cdn/x.mp4'] }).body.type, 'STORIES');
});

test('accountId is optional and omitted from the body when absent', () => {
  for (const args of [
    { platform: 'facebook', text: 'hi' },
    { platform: 'instagram', mediaUrls: ['https://cdn/x.jpg'] },
    { platform: 'youtube', title: 't', videoUrl: 'https://cdn/x.mp4' },
    { platform: 'pinterest', boardId: 'b1', title: 't', imageUrl: 'https://cdn/x.jpg' },
    { platform: 'linkedin', text: 'hi' },
    { platform: 'tiktok', videoUrl: 'https://cdn/x.mp4' },
  ]) {
    const { body } = buildPublishBody(args);
    for (const key of ['pageId', 'instagramAccountId', 'channelId', 'pinterestUserId', 'linkedinUserId', 'tiktokAccountId']) {
      assert.equal(key in body, false, `${args.platform} should not send ${key}`);
    }
  }
  assert.equal(buildPublishBody({ platform: 'facebook', text: 'x', accountId: 'p1' }).body.pageId, 'p1');
  assert.throws(() => buildPublishBody({ platform: 'pinterest', title: 't', imageUrl: 'https://cdn/x.jpg' }), /boardId/);
});

test('empty postId is reported without telling the agent to poll', () => {
  const r = summarizePublishResponse('facebook', { success: true, accepted: true }, 'k', true);
  assert.equal(r.postId, null);
  assert.equal(r.shouldPoll, false);
  assert.match(String(r.warning), /postifys_list_post_history/);
  const sync = summarizePublishResponse('facebook', { success: true, data: { id: '1' }, historyId: 'h1' }, 'k', false);
  assert.equal(sync.status, 'published');
  assert.equal(sync.shouldPoll, false);
});

test('retry/backoff: GET retries on 503, POST without Idempotency-Key does not', async () => {
  let gets = 0;
  let posts = 0;
  const mock = await startMock((req, res) => {
    if (req.method === 'GET') { gets += 1; return gets < 3 ? json(res, 503, { error: 'busy' }) : json(res, 200, { ok: true }); }
    posts += 1;
    return json(res, 502, { error: 'bad gateway' });
  });
  try {
    const client = new PostifysClient({ apiKey: 'k', serverUrl: mock.url, maxRetries: 3, retryBaseMs: 1 });
    assert.deepEqual(await client.request({ path: '/x' }), { ok: true });
    assert.equal(gets, 3);
    await assert.rejects(client.request({ path: '/p', method: 'POST', body: {} }), { statusCode: 502 });
    assert.equal(posts, 1, 'non-idempotent POST must not be retried');
    await assert.rejects(client.request({ path: '/p', method: 'POST', body: {}, headers: { 'Idempotency-Key': 'abc' } }), { statusCode: 502 });
    assert.equal(posts, 5, 'POST with Idempotency-Key is retried (1 + 3)');
  } finally {
    await mock.close();
  }
});

test('configurable timeout', async () => {
  const mock = await startMock((_req, res) => { setTimeout(() => json(res, 200, {}), 500); });
  try {
    const client = new PostifysClient({ apiKey: 'k', serverUrl: mock.url, timeoutMs: 50, maxRetries: 0 });
    await assert.rejects(client.request({ path: '/slow' }), { code: 'POSTIFYS_TIMEOUT' });
  } finally {
    await mock.close();
  }
});

test('stdio server: version, tools, publish with auto Idempotency-Key + 429 retry, history, retry_post', async () => {
  let publishCalls = 0;
  const mock = await startMock((req, res) => {
    if (req.url.startsWith('/api/facebook/post')) {
      publishCalls += 1;
      if (publishCalls === 1) return json(res, 429, { error: 'slow down' }, { 'Retry-After': '0' });
      return json(res, 202, { success: true, accepted: true, status: 'queued', postId: 'evt_1' });
    }
    if (req.url.startsWith('/api/posts/history')) return json(res, 200, { posts: [{ id: 'evt_f', status: 'failed' }], page: 1 });
    if (req.url === '/api/posts/evt_f/retry') return json(res, 202, { success: true, accepted: true, status: 'queued', postId: 'evt_2' });
    return json(res, 404, { error: 'nope' });
  });
  const client = await connect(mock.url);
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    assert.equal(client.getServerVersion()?.version, pkg.version);

    const tools = (await client.listTools()).tools.map((t) => t.name);
    for (const name of ['postifys_publish', 'postifys_get_post_status', 'postifys_list_post_history', 'postifys_retry_post']) {
      assert.ok(tools.includes(name), `missing ${name}`);
    }

    const pub = await callJson(client, 'postifys_publish', { platform: 'facebook', mediaUrls: ['https://cdn/x.jpg'] });
    assert.equal(pub.isError, false, JSON.stringify(pub.json));
    assert.equal(pub.json.postId, 'evt_1');
    const publishes = mock.seen.filter((s) => s.url.startsWith('/api/facebook/post'));
    assert.equal(publishes.length, 2, '429 retried once');
    const key = publishes[0].headers['idempotency-key'];
    assert.match(String(key), /^mcp_/);
    assert.equal(publishes[1].headers['idempotency-key'], key, 'same key on retry');
    assert.equal(publishes[0].body.type, 'IMAGE');
    assert.equal('pageId' in publishes[0].body, false);

    const hist = await callJson(client, 'postifys_list_post_history', { status: 'failed', limit: 5 });
    assert.equal(hist.json.posts[0].id, 'evt_f');
    assert.ok(mock.seen.some((s) => s.url.includes('/api/posts/history?') && s.url.includes('status=failed') && s.url.includes('limit=5')));

    const retry = await callJson(client, 'postifys_retry_post', { postId: 'evt_f' });
    assert.equal(retry.json.postId, 'evt_2');
    assert.equal(retry.json.shouldPoll, true);
  } finally {
    await client.close();
    await mock.close();
  }
});
