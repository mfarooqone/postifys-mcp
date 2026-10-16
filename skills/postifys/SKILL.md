---
name: postifys
description: Publish social media posts with the Postifys MCP tools (Facebook, Instagram, YouTube, Pinterest, LinkedIn, TikTok). Use when the user asks to post, schedule, upload media, check a post's status, see post history, or retry a failed post via Postifys.
---

# Publishing with Postifys

## When to use

- The user wants to publish or schedule content to Facebook, Instagram, YouTube, Pinterest, LinkedIn, or TikTok.
- The user asks whether a post went live, wants recent post history, or wants to retry a failed post.

## Workflow

1. **Check access:** call `postifys_ping`. A 401 means the API key is missing or wrong; 402 means the Postifys account needs an active plan.
2. **Pick the account:** call `postifys_list_connections` (optionally with `platform`). `accountId` is optional; when omitted Postifys uses the default connected account for that platform. Pass it when the user has several accounts.
3. **Prepare media:** never pass Google Drive or Dropbox links straight to publish. Call `postifys_media_upload` with the source URL and use the returned `serve_url`.
4. **Publish:** call `postifys_publish` with `platform`, text/caption, and media.
   - Facebook `type`: `IMAGE` (default with media), `REEL`, `FEED` (default without media), `STORIES`.
   - Instagram `type`: `IMAGE` (default), `REEL`, `STORIES`. Use `REEL` for video.
   - YouTube needs `title` and a video URL; Pinterest needs `boardId` (from `postifys_list_pinterest_boards`) and an image; LinkedIn supports `text`, `image`, `video`, `link`.
   - TikTok: prefer `postMode: "inbox"`. Direct Post needs `privacy` from `postifys_tiktok_creator_info` plus explicit user consent and music confirmation.
   - An `Idempotency-Key` is sent automatically, so transient errors are retried without double-posting. Do not call publish again for the same post unless the user asks.
5. **Track it:** poll `postifys_get_post_status` with the returned `postId` until `isComplete` is true. If publish returned no `postId`, look it up with `postifys_list_post_history` instead of re-publishing.
6. **Recover:** list failures with `postifys_list_post_history` (`status: "failed"`), explain the `failureReason`, and only call `postifys_retry_post` after the user agrees.

## Limits to tell the user

- LinkedIn: member profiles only (no Company Pages).
- Pinterest: image Pins; `boardId` is required.
- TikTok may land in the creator inbox unless Direct Post is approved.
- Content Queue tools (`postifys_cq_*`) schedule recurring posts from a table without n8n; intervals are at least 15 minutes.
