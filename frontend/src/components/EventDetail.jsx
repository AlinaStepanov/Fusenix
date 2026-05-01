import { useMemo, useState, useEffect } from "react";
import { SOURCE_META } from "../constants.js";
import { SourceBadge } from "./SourceBadge.jsx";
import { SeverityTag } from "./SeverityDot.jsx";
import { fmtDatetime, fmtTime, fmtDate } from "../utils.js";
import { api } from "../api.js";

export function EventDetail({ event, onClose, contextEvents = [] }) {
  const nearbyEvents = useMemo(() => {
    if (!event || !contextEvents.length) return [];
    const T   = new Date(event.time).getTime();
    const WIN = 15 * 60 * 1000;
    return contextEvents
      .filter(e => e.id !== event.id && Math.abs(new Date(e.time).getTime() - T) <= WIN)
      .sort((a, b) => new Date(a.time) - new Date(b.time));
  }, [event, contextEvents]);

  if (!event) return null;
  const m = SOURCE_META[event.source] ?? { color: "#4a5568" };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--surface)" }}>
      {/* sticky header */}
      <div style={{
        padding: "14px 18px", borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0,
      }}>
        <SourceBadge source={event.source} />
        <SeverityTag severity={event.severity} />
        <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
          {fmtDatetime(event.time)}
        </span>
        {onClose && (
          <button onClick={onClose} title="Close panel" style={{
            background: "none", border: "none", color: "var(--muted)", fontSize: 18,
            cursor: "pointer", lineHeight: 1, padding: "0 2px", transition: "color 0.1s",
          }}
            onMouseEnter={e => e.target.style.color = "var(--text)"}
            onMouseLeave={e => e.target.style.color = "var(--muted)"}
          >×</button>
        )}
      </div>

      {/* scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 18px 24px" }}>
        <div style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, lineHeight: 1.45, marginBottom: 14 }}>
          {event.title}
        </div>

        {event.detail && (
          <div style={{
            padding: "11px 14px", background: "var(--bg)",
            borderLeft: `3px solid ${m.color}`, borderRadius: "0 6px 6px 0",
            fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.7,
            color: "var(--text-dim)", marginBottom: 14,
            wordBreak: "break-word", whiteSpace: "pre-wrap",
          }}>
            {event.detail}
          </div>
        )}

        {event.tags?.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            {event.tags.map(t => (
              <span key={t} style={{
                padding: "2px 8px", borderRadius: 4, fontSize: 11,
                fontFamily: "var(--font-mono)", background: "var(--border)", color: "var(--text-dim)",
              }}>#{t}</span>
            ))}
          </div>
        )}

        {/* GitHub deploy diff section */}
        {event.source === "github" && event.raw?.type === "deployment" && (
          <DeployDiffSection event={event} />
        )}

        {event.raw && Object.keys(event.raw).length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
              Raw
            </div>
            <div style={{
              padding: "8px 12px", background: "var(--bg)", border: "1px solid var(--border)",
              borderRadius: 5, fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1.6, color: "var(--muted)",
            }}>
              {Object.entries(event.raw).map(([k, v]) => (
                <div key={k}>
                  <span style={{ color: "var(--text-dim)" }}>{k}</span>
                  <span style={{ color: "var(--border-hi)" }}>{" = "}</span>
                  <span>{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {event.url && (
          <a href={event.url} target="_blank" rel="noreferrer" style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            color: m.color, fontSize: 12, fontFamily: "var(--font-mono)", textDecoration: "none",
          }}>
            ↗ Open in {SOURCE_META[event.source]?.label ?? event.source}
          </a>
        )}

        {contextEvents.length > 0 && (
          <NearbySection event={event} nearbyEvents={nearbyEvents} />
        )}
      </div>
    </div>
  );
}

// ── GitHub deploy diff ────────────────────────────────────────────────────────

function DeployDiffSection({ event }) {
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const { owner, repo, ref } = event.raw ?? {};

  useEffect(() => {
    if (!owner || !repo || !ref) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    api.getDeployDiff(owner, repo, ref)
      .then(data => { setDiff(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [owner, repo, ref]);

  if (!owner || !repo) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
        Deploy diff
      </div>
      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>

        {loading && (
          <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
            Fetching diff…
          </div>
        )}

        {error && (
          <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--red)", fontFamily: "var(--font-mono)" }}>
            ⚠ {error}
          </div>
        )}

        {diff && !loading && (
          <>
            {/* Summary row */}
            <div style={{
              padding: "8px 12px", display: "flex", gap: 12, alignItems: "center",
              borderBottom: "1px solid var(--border)", flexWrap: "wrap",
            }}>
              {diff.commit_count > 0 && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--blue)" }}>
                  ◉ {diff.commit_count} commit{diff.commit_count !== 1 ? "s" : ""}
                </span>
              )}
              {diff.prs.length > 0 && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--purple)" }}>
                  ⑂ {diff.prs.length} merged PR{diff.prs.length !== 1 ? "s" : ""}
                </span>
              )}
              <a href={diff.compare_url} target="_blank" rel="noreferrer" style={{
                fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)",
                textDecoration: "none", marginLeft: "auto",
              }}>
                ↗ View on GitHub
              </a>
            </div>

            {/* Recent merged PRs */}
            {diff.prs.length > 0 && (
              <div style={{ padding: "8px 12px" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
                  Recently merged PRs
                </div>
                {(showAll ? diff.prs : diff.prs.slice(0, 3)).map(pr => (
                  <div key={pr.number} style={{
                    display: "flex", gap: 8, alignItems: "flex-start",
                    padding: "4px 0", borderBottom: "1px solid var(--border)",
                  }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--purple)", flexShrink: 0, paddingTop: 2 }}>
                      #{pr.number}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <a href={pr.url} target="_blank" rel="noreferrer" style={{
                        fontSize: 11, color: "var(--text-dim)", textDecoration: "none",
                        display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                        title={pr.title}
                        onMouseEnter={e => e.target.style.color = "var(--text)"}
                        onMouseLeave={e => e.target.style.color = "var(--text-dim)"}
                      >
                        {pr.title}
                      </a>
                      <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                        @{pr.author}
                      </span>
                    </div>
                  </div>
                ))}
                {diff.prs.length > 3 && (
                  <button onClick={() => setShowAll(v => !v)} style={{
                    marginTop: 6, background: "none", border: "none", padding: 0,
                    fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--blue)", cursor: "pointer",
                  }}>
                    {showAll ? "Show less ↑" : `Show all ${diff.prs.length} PRs ↓`}
                  </button>
                )}
              </div>
            )}

            {/* Commits (if compare available) */}
            {diff.commits.length > 0 && (
              <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border)" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
                  Commits in this deploy
                </div>
                {diff.commits.slice(0, 5).map(c => (
                  <div key={c.sha} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "3px 0" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", flexShrink: 0 }}>
                      {c.sha}
                    </span>
                    <a href={c.url} target="_blank" rel="noreferrer" style={{
                      fontSize: 11, color: "var(--text-dim)", textDecoration: "none",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                    }}>
                      {c.message}
                    </a>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Nearby events section ─────────────────────────────────────────────────────

function NearbySection({ event, nearbyEvents }) {
  const SEV_COLOR = { critical: "var(--red)", warning: "var(--yellow)", info: "var(--blue)", success: "var(--green)" };
  const T = new Date(event.time).getTime();
  const before = nearbyEvents.filter(e => new Date(e.time).getTime() < T);
  const after  = nearbyEvents.filter(e => new Date(e.time).getTime() >= T);

  const NearbyRow = ({ e, diffMin, isAnchor }) => {
    const em = SOURCE_META[e.source] ?? { color: "#8896a8", label: e.source };
    const isBefore   = diffMin < 0;
    const deltaColor = isAnchor ? "#E24B4A" : isBefore ? "#185FA5" : "#3B6D11";
    const deltaLabel = isAnchor ? "now" : isBefore ? `${diffMin}m` : `+${diffMin}m`;
    return (
      <div style={{
        display: "grid", gridTemplateColumns: "30px 3px 1fr", gap: "0 9px", alignItems: "start",
        padding: "7px 8px", borderRadius: 5, marginBottom: 2,
        background: isAnchor ? "rgba(226,75,74,0.06)" : "var(--bg)",
        border: isAnchor ? "1px solid rgba(226,75,74,0.2)" : "1px solid var(--border)",
      }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, color: deltaColor, paddingTop: 2, textAlign: "right" }}>
          {deltaLabel}
        </div>
        <div style={{ width: 3, borderRadius: 2, alignSelf: "stretch", background: SEV_COLOR[e.severity] ?? "var(--border-hi)" }} />
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2, flexWrap: "wrap" }}>
            <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", fontWeight: 600, color: em.color, textTransform: "uppercase", letterSpacing: 0.4 }}>{em.label}</span>
            <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{fmtTime(e.time)}</span>
          </div>
          <div style={{
            fontSize: 11, lineHeight: 1.4,
            color: isAnchor ? "var(--text)" : "var(--text-dim)",
            fontWeight: isAnchor ? 500 : 400,
            overflow: "hidden", textOverflow: "ellipsis",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          }}>{e.title}</div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>What else happened nearby</span>
        <span style={{
          background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "1px 7px",
          fontSize: 10, color: "var(--muted)", fontFamily: "var(--font-mono)",
        }}>±15 min</span>
      </div>
      {nearbyEvents.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--border-hi)", fontStyle: "italic", paddingLeft: 2 }}>
          Nothing else in this window — this event stands alone.
        </div>
      ) : (
        <div>
          {before.map(e => <NearbyRow key={e.id} e={e} diffMin={Math.round((new Date(e.time).getTime() - T) / 60000)} isAnchor={false} />)}
          <NearbyRow key={event.id} e={event} diffMin={0} isAnchor={true} />
          {after.map(e => <NearbyRow key={e.id} e={e} diffMin={Math.round((new Date(e.time).getTime() - T) / 60000)} isAnchor={false} />)}
        </div>
      )}
    </div>
  );
}
