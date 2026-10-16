# postifys-mcp

Official [Model Context Protocol](https://modelcontextprotocol.io) server for [Postifys](https://postifys.com). Agents call the production Postifys API with your API key — the same surface as the [n8n community node](https://www.npmjs.com/package/n8n-nodes-postifys).

The package is free. Publishing still requires a Postifys entitlement (trial or paid seat).

## What's new in 0.2.0

- New tools: `postifys_list_post_history` and `postifys_retry_post`.
- `accountId` is optional (Postifys uses your default account per platform).
- Default `type` now matches the API docs: Facebook `IMAGE` with media / `FEED` without; Instagram `IMAGE` (pass `REEL` for video).
- Automatic retries with backoff for 429/5xx; publishes always send an `Idempotency-Key` so retries never double-post.
- Configurable `POSTIFYS_TIMEOUT_MS`, `POSTIFYS_MAX_RETRIES`, `POSTIFYS_RETRY_BASE_MS`.
- Handles a missing `postId` safely; server version read from package.json.

## Cursor plugin (Marketplace)

This repo is also a [Cursor plugin](https://cursor.com/docs/reference/plugins) named `postifys`:

- `.cursor-plugin/plugin.json`: manifest. Declares one variable, `POSTIFYS_API_KEY`, which is required.
- `mcp.json`: starts the server with `npx -y postifys-mcp@latest` and passes `POSTIFYS_API_KEY` in.
- `skills/postifys/SKILL.md`: tells the agent how to publish with these tools.
- `assets/logo.png`: the plugin logo.

To set it up:

1. Install **Postifys** from the Cursor Marketplace.
2. Open **Plugins → Postifys → Configure**.
3. Paste your API key (from Postifys → Settings → API keys).

The plugin always talks to `https://postifys.com`. To point it at another server, or to change the timeout or retry settings, use the manual MCP config below with the environment variables listed under *Env*.

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
| `POSTIFYS_TIMEOUT_MS` | no | `60000` (per attempt) |
| `POSTIFYS_MAX_RETRIES` | no | `3` |
| `POSTIFYS_RETRY_BASE_MS` | no | `500` (exponential backoff + jitter; honours `Retry-After`) |

Retries apply to 429/5xx/network errors on safe requests only. `postifys_publish` always sends an `Idempotency-Key` (auto-generated unless you pass `idempotencyKey`), so a retried publish is not duplicated. Other non-idempotent calls (media upload, retry post) are never auto-retried.

## Tools

**Discovery:** `postifys_ping`, `postifys_list_connections`, `postifys_list_pinterest_boards`, `postifys_tiktok_creator_info`

**Media:** `postifys_media_upload` (queues + polls for `serve_url`), `postifys_media_status`

**Publish:** `postifys_publish` (Facebook, Instagram, YouTube, Pinterest, LinkedIn, TikTok; async by default), `postifys_get_post_status`, `postifys_list_post_history`, `postifys_retry_post`

`accountId` is optional: when omitted, Postifys uses your default/first connected account for that platform (Pinterest still needs `boardId`). Default `type`: Facebook `IMAGE` with media / `FEED` without; Instagram `IMAGE`. Pass `REEL` for video.

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
npm run test:mcp                          # offline tests against a local mock API
POSTIFYS_API_KEY=pfs_... npm run test:live  # full stdio run against production
```

## Links

- Product page: https://postifys.com/mcp
- API docs: https://postifys.com/api-docs
- n8n node: https://postifys.com/n8n
- npm: https://www.npmjs.com/package/postifys-mcp

## License

MIT
