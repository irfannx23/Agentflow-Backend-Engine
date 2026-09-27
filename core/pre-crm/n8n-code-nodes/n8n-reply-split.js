// Reply->Deal cron (n8n workflow id=2): split the get_replied_outreach RPC
// result ({ok: true, rows: [...]}) into one item per replied row so the
// downstream HubSpot nodes run per row. Zero rows -> [] ends the branch
// silently (nothing to do this tick) — the n8n zero-item behaviour IS the
// desired no-op here, so no IF node is needed.
export default function splitRepliedRows() {
  const payload = Array.isArray($json)
    ? (Array.isArray($json[0]) ? ($json[0][0] || {}) : ($json[0] || {}))
    : ($json || {});
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length) return [];
  return rows.map((r) => ({ json: r }));
}
