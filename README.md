# postifys-mcp

Official [Model Context Protocol](https://modelcontextprotocol.io) server for [Postifys](https://postifys.com). Agents call the production Postifys API with your API key — the same surface as the [n8n community node](https://www.npmjs.com/package/n8n-nodes-postifys).

The package is free. Publishing still requires a Postifys entitlement (trial or paid seat).

## Install (Cursor)

1. Create an API key in Postifys → Settings (scopes: `connections`, `media`, `publish`, `status`).
2. Add to Cursor MCP settings (or merge [cursor.mcp.example.json](./cursor.mcp.example.json)):

```json
{
  "mcpServers": {
    "postifys": {
      "command": "npx",
      "args": ["-y", "postifys-mcp"],
      "env": {
        "POSTIFYS_API_KEY": "pfs_...",
        "POSTIFYS_SERVER_URL": "https://postifys.com"
      }
    }
  }
}
```

## Claude Desktop

```json
{
  "mcpServers": {
    "postifys": {
      "command": "npx",
      "args": ["-y", "postifys-mcp"],
      "env": {
        "POSTIFYS_API_KEY": "pfs_..."
      }
    }
  }
}
```

## Env

| Variable | Required | Default |
|---|---|---|
| `POSTIFYS_API_KEY` | yes | — |
| `POSTIFYS_SERVER_URL` | no | `https://postifys.com` |

## Tools

**Discovery:** `postifys_ping`, `postifys_list_connections`, `postifys_list_pinterest_boards`, `postifys_tiktok_creator_info`

**Media:** `postifys_media_upload` (queues + polls for `serve_url`), `postifys_media_status`

**Publish:** `postifys_publish` (Facebook, Instagram, YouTube, Pinterest, LinkedIn, TikTok; always async), `postifys_get_post_status`

**Content Queue:** `postifys_cq_overview`, `postifys_cq_list_tables`, `postifys_cq_create_table`, `postifys_cq_list_jobs`, `postifys_cq_create_or_update_job`, `postifys_cq_run_job_now`, `postifys_cq_list_items`, `postifys_cq_add_item`, `postifys_cq_import_rows`

## Honest limits

- TikTok may land in the creator inbox; Direct Post needs approval, consent, and music confirmation.
- LinkedIn: member profiles only (no Company Pages).
- Pinterest: image Pins; `boardId` required.
- Prefer **media upload → `serve_url` → publish**. Do not pass raw Drive/Dropbox URLs to publish.
- Content Queue job intervals are at least **15 minutes** on production.

## Sample prompts

- “List my Instagram connections, upload this Drive MP4 via Postifys media, then publish a Reel.”
- “Create a Content Queue table named smoke-mcp and add one pending row (do not run the job).”

## Local develop

```bash
npm install
npm run build
POSTIFYS_API_KEY=pfs_... npm start
POSTIFYS_API_KEY=pfs_... npm run smoke
```

## Links

- Product page: https://postifys.com/mcp
- API docs: https://postifys.com/api-docs
- n8n node: https://postifys.com/n8n
- npm: https://www.npmjs.com/package/postifys-mcp

## License

MIT
