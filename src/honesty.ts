/** Shared honesty strings for tool descriptions (match n8n + site). */

export const HONEST_LIMITS = [
  'TikTok may post to the creator inbox unless Direct Post is approved; Direct Post requires privacy from creator_info, consent, and music usage confirmation.',
  'LinkedIn supports member profiles only (no Company Pages).',
  'Pinterest supports image Pins; boardId is required. Video Pins are not claimed.',
  'Prefer Media upload → serve_url → Publish. Do not pass raw Google Drive or Dropbox URLs directly to publish tools.',
  'Publishing requires an entitled Postifys account ($2/seat/month after trial). The MCP package itself is free.',
].join(' ');

export const CQ_DESCRIPTION =
  'Native Postifys Content Queue (scheduler without n8n). Requires CONTENT_QUEUE_ENABLED on the server and publish entitlement.';
