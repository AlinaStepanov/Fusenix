import { SOURCE_META } from "../constants.js";
import { SourceBadge } from "./SourceBadge.jsx";
import { SeverityDot } from "./SeverityDot.jsx";
import { fmtTime } from "../utils.js";

export function TimelineEvent({ event, isSelected, onClick, animDelay = 0 }) {
  const m = SOURCE_META[event.source] ?? { color: "#8896a8" };

  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", gap: 12,
        padding: "11px 16px",
        cursor: "pointer",
        borderLeft: `3px solid ${isSelected ? m.color : "transparent"}`,
        borderBottom: "1px solid var(--border)",
        background: isSelected ? "var(--surface2)" : "transparent",
        transition: "background 0.12s, border-color 0.12s",
        animation: `fadeUp 0.2s ease ${animDelay}s both`,
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "rgba(0,0,0,0.035)"; }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
    >
      {/* timestamp */}
      <div style={{
        width: 68, flexShrink: 0,
        fontFamily: "var(--font-mono)", fontSize: 11,
        color: "var(--muted)", paddingTop: 3, lineHeight: 1.3,
      }}>
        {fmtTime(event.time)}
      </div>

      {/* severity dot */}
      <div style={{ paddingTop: 5, flexShrink: 0 }}>
        <SeverityDot severity={event.severity} />
      </div>

      {/* content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 4 }}>
          <SourceBadge source={event.source} />
          <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 500, lineHeight: 1.4 }}>
            {event.title}
          </span>
        </div>

        {event.detail && (
          <div style={{
            color: "var(--text-dim)", fontSize: 12,
            lineHeight: 1.55, marginBottom: event.tags?.length ? 6 : 0,
            overflow: "hidden", textOverflow: "ellipsis",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          }}>
            {event.detail}
          </div>
        )}

        {event.tags?.length > 0 && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {event.tags.map(t => (
              <span key={t} style={{
                padding: "1px 6px", borderRadius: 3,
                fontSize: 10, fontFamily: "var(--font-mono)",
                background: "var(--border)", color: "var(--text-dim)",
              }}>
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
