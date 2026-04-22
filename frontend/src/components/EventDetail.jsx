import { SOURCE_META } from "../constants.js";
import { SourceBadge } from "./SourceBadge.jsx";
import { SeverityTag } from "./SeverityDot.jsx";
import { fmtDatetime } from "../utils.js";

/**
 * FIX: added onClose prop and close button in header.
 * Previously onClose was passed by App.jsx but never used here.
 */
export function EventDetail({ event, onClose }) {
  if (!event) return null;
  const m = SOURCE_META[event.source] ?? { color: "#4a5568" };

  return (
    <div style={{
      height: "100%",
      display: "flex",
      flexDirection: "column",
      background: "var(--surface)",
    }}>
      {/* sticky header */}
      <div style={{
        padding: "14px 18px",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        flexShrink: 0,
      }}>
        <SourceBadge source={event.source} />
        <SeverityTag severity={event.severity} />
        <span style={{
          marginLeft: "auto",
          color: "var(--muted)", fontSize: 11,
          fontFamily: "var(--font-mono)",
        }}>
          {fmtDatetime(event.time)}
        </span>
        {onClose && (
          <button
            onClick={onClose}
            title="Close panel"
            style={{
              background: "none", border: "none",
              color: "var(--muted)", fontSize: 18,
              cursor: "pointer", lineHeight: 1,
              padding: "0 2px",
              transition: "color 0.1s",
            }}
            onMouseEnter={e => e.target.style.color = "var(--text)"}
            onMouseLeave={e => e.target.style.color = "var(--muted)"}
          >
            ×
          </button>
        )}
      </div>

      {/* scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 18px 24px" }}>
        {/* title */}
        <div style={{
          color: "var(--text)", fontSize: 15, fontWeight: 600,
          lineHeight: 1.45, marginBottom: 14,
        }}>
          {event.title}
        </div>

        {/* detail block */}
        {event.detail && (
          <div style={{
            padding: "11px 14px",
            background: "var(--border)",
            borderLeft: `3px solid ${m.color}`,
            borderRadius: "0 6px 6px 0",
            fontFamily: "var(--font-mono)",
            fontSize: 12, lineHeight: 1.7,
            color: "var(--text-dim)",
            marginBottom: 14,
            wordBreak: "break-word",
            whiteSpace: "pre-wrap",
          }}>
            {event.detail}
          </div>
        )}

        {/* tags */}
        {event.tags?.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            {event.tags.map(t => (
              <span key={t} style={{
                padding: "2px 8px", borderRadius: 4,
                fontSize: 11, fontFamily: "var(--font-mono)",
                background: "var(--border-hi)", color: "var(--text)",
              }}>
                #{t}
              </span>
            ))}
          </div>
        )}

        {/* raw metadata (collapsible feel via mono block) */}
        {event.raw && Object.keys(event.raw).length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 10,
              color: "var(--muted)", textTransform: "uppercase",
              letterSpacing: 1, marginBottom: 6,
            }}>
              Raw
            </div>
            <div style={{
              padding: "8px 12px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              fontFamily: "var(--font-mono)",
              fontSize: 11, lineHeight: 1.6,
              color: "var(--muted)",
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

        {/* external link */}
        {event.url && (
          <a
            href={event.url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              color: m.color, fontSize: 12,
              fontFamily: "var(--font-mono)", textDecoration: "none",
            }}
          >
            ↗ Open in {SOURCE_META[event.source]?.label ?? event.source}
          </a>
        )}
      </div>
    </div>
  );
}
