const BASE = import.meta.env.VITE_API_URL || "";  // empty = relative URLs, proxied by nginx in Docker / Vite dev server locally

async function request(path, opts = {}) {
  const resp = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API ${resp.status}: ${text}`);
  }
  return resp.json();
}

export const api = {
  /** Fetch unified timeline */
  getTimeline: (start, end, sources = ["cloudwatch", "github"]) =>
    request(
      `/timeline?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&sources=${sources.join(",")}`
    ),

  /** Run AI root-cause analysis */
  analyze: (events) =>
    request("/analyze", {
      method: "POST",
      body: JSON.stringify({ events }),
    }),

  /** Check which integrations are configured */
  sourcesStatus: () => request("/sources/status"),

  /** Audit CloudWatch alarm configurations (CloudWatch only — legacy) */
  auditAlarms: () => request("/audit/alarms"),

  /** Unified multi-source configuration audit */
  auditAll: () => request("/audit"),

  /** Health check */
  health: () => request("/health"),
};