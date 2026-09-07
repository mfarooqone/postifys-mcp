#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PostifysClient, PostifysApiError, loadConfig } from './client.js';
import { registerDiscoveryTools } from './tools/discovery.js';
import { registerMediaTools } from './tools/media.js';
import { registerPublishTools } from './tools/publish.js';
import { registerContentQueueTools } from './tools/contentQueue.js';

const PACKAGE_VERSION = '0.1.1';

async function main() {
  let client: PostifysClient;
  try {
    client = new PostifysClient(loadConfig());
  } catch (error) {
    const message = error instanceof PostifysApiError ? error.message : (error as Error).message;
    console.error(`[postifys-mcp] ${message}`);
    process.exit(1);
  }

  const server = new McpServer({
    name: 'postifys-mcp',
    version: PACKAGE_VERSION,
  });

  registerDiscoveryTools(server, client);
  registerMediaTools(server, client);
  registerPublishTools(server, client);
  registerContentQueueTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('[postifys-mcp] fatal:', error);
  process.exit(1);
});
