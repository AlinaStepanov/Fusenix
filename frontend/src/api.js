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
  // ── Timeline ───────────────────────────────────────────────────────────────

  /** Fetch unified timeline */
  getTimeline: (start, end, sources = ["cloudwatch", "github"]) =>
    request(
      `/timeline?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&sources=${sources.join(",")}`
    ),

  /** Run AI root-cause analysis */
  analyze: (events) =>
    request("/analyze", { method: "POST", body: JSON.stringify({ events }) }),

  /** Check which integrations are configured */
  sourcesStatus: () => request("/sources/status"),

  /** Audit CloudWatch alarm configurations (CloudWatch only — legacy) */
  auditAlarms: () => request("/audit/alarms"),

  /** Unified multi-source configuration audit */
  auditAll: () => request("/audit"),

  /** Health check */
  health: () => request("/health"),

  /** GitHub deploy diff */
  getDeployDiff: (owner, repo, ref, prevRef) => {
    const p = new URLSearchParams({ owner, repo, ref });
    if (prevRef) p.append("prev_ref", prevRef);
    return request(`/github/deploy-diff?${p.toString()}`);
  },

  // ── Service Map ────────────────────────────────────────────────────────────

  /**
   * Fetch all services with live health data (CloudWatch + Grafana + PagerDuty + GitHub).
   * Returns { teams: [...], services: [...] }
   */
  getServices: () => request("/services"),

  /**
   * Fetch detailed health for a single service by its config id.
   */
  getServiceDetail: (serviceId) => request(`/services/${encodeURIComponent(serviceId)}`),

  /**
   * Level 2 drill-down: unified timeline for one service from its configured
   * sources + cross-service correlation context.
   * Returns { events, related_services, window, service_id, service_name }
   */
  getServiceTimeline: (serviceId, windowHours = 4) =>
    request(`/services/${encodeURIComponent(serviceId)}/timeline?window_hours=${windowHours}`),

  // ── On-call ────────────────────────────────────────────────────────────────

  /**
   * Fetch current on-call assignments from PagerDuty.
   * Returns { configured: bool, oncall: [...] }
   */
  getOncall: () => request("/oncall"),

  // ── Active incidents ───────────────────────────────────────────────────────

  /**
   * Fetch all currently triggered / acknowledged PagerDuty incidents.
   * Returns { configured: bool, incidents: [...], count: int }
   */
  getActiveIncidents: () => request("/incidents/active"),

  // ── Auto-discovery ─────────────────────────────────────────────────────────

  /**
   * Auto-discover services from connected APIs (CW, PD, Grafana, GitHub).
   * Returns { raw, suggested_services, yaml, summary }
   */
  discoverServices: () => request("/discover"),

  /**
   * Save the supplied YAML string to services.yml on the server.
   * Returns { path, backup_path, service_count, bytes_written }
   */
  saveDiscoveredServices: (yaml) =>
    request("/discover/save", { method: "POST", body: JSON.stringify({ yaml }) }),
};
