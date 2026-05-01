import { useState, useEffect, useRef } from "react";
import { SOURCE_META } from "../constants.js";
import { SourceBadge } from "./SourceBadge.jsx";
import { SeverityDot } from "./SeverityDot.jsx";
import { fmtTime, fmtTimeUTC, fmtDate } from "../utils.js";

// Severity visual config
const SEV_CONFIG = {
  critical: {
    borderColor: "var(--red)",
    bgTint: "rgba(220,38,38,0.05)",
    titleColor: "var(--text)",
    titleWeight: 600,
  },
  warning: {
    borderColor: "var(--yellow)",
    bgTint: "rgba(180,83,9,0.04)",
    titleColor: "var(--text)",
    titleWeight: 500,
  },
  info: {
    borderColor: "transparent",
    bgTint: "transparent",
    titleColor: "var(--text)",
    titleWeight: 500,
  },
  success: {
    borderColor: "transparent",
    bgTint: "transparent",
    titleColor: "var(--text)",
    titleWeight: 500,
  },
};

export function TimelineEvent({
  event,
  isSelected,
  onClick,
  animDelay = 0,
  // Tag filtering
  onTagClick,
  activeTagFilters = [],
  // T=0 anchor
  anchorTime,
  isAnchor,
  onSetAnchor,
  // Correlation grouping
  correlationGroupId,
  correlationColor,
  isFirstInGroup,
  isLastInGroup,
  isInGroup,
}) {
  const m = SOURCE_META[event.source] ?? { color: "#8896a8" };
  const sev = SEV_CONFIG[event.severity] ?? SEV_CONFIG.info;
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y }
  const rowRef = useRef(null);

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = () => setCtxMenu(null);
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [ctxMenu]);

  const handleRightClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  // Relative timestamp to anchor
  let relativeLabel = null;
  if (anchorTime != null) {
    const tMs  = new Date(event.time).getTime();
    const diff = Math.round((tMs - anchorTime) / 60000); // minutes
    if (isAnchor) {
      relativeLabel = { label: "T=0", color: "var(--red)", weight: 700 };
    } else if (diff === 0) {
      relativeLabel = { label: "±0m", color: "var(--muted)", weight: 500 };
    } else if (diff > 0) {
      relativeLabel = { label: `+${diff}m`, color: "var(--green)", weight: 600 };
    } else {
      relativeLabel = { label: `${diff}m`, color: "var(--blue)", weight: 600 };
    }
  }

  // Recurrence badge for CloudWatch alarm events
  const recurrence = (event.source === "cloudwatch" && event.raw?.recurrence_7d != null && event.raw.recurrence_7d > 1)
    ? event.raw.recurrence_7d
    : null;

  // Left border logic: selected > severity > correlation group > none
  const leftBorderColor = isSelected
    ? m.color
    : isAnchor
    ? "var(--red)"
    : isInGroup
    ? (correlationColor || "var(--border-hi)")
    : sev.borderColor;

  const bgColor = isSelected
    ? "var(--surface2)"
    : isAnchor
    ? "rgba(220,38,38,0.06)"
    : sev.bgTint;

  return (
    <>
      {/* Anchor dashed marker line — rendered ABOVE the row */}
      {isAnchor && (
        <div style={{
          position: "relative",
          height: 0,
          overflow: "visible",
          zIndex: 10,
        }}>
          <div style={{
            position: "absolute",
            left: 0, right: 0,
            top: 0,
            height: 0,
            borderTop: "2px dashed var(--red)",
            opacity: 0.6,
          }} />
          <div style={{
            position: "absolute",
            left: 12,
            top: -10,
            background: "var(--red)",
            color: "#fff",
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            padding: "1px 6px",
            borderRadius: 3,
            letterSpacing: 0.5,
            zIndex: 11,
          }}>
            T=0 INCIDENT START
          </div>
        </div>
      )}

      <div
        ref={rowRef}
        onClick={onClick}
        onContextMenu={handleRightClick}
        style={{
          display: "flex", gap: 10,
          padding: event.severity === "critical" ? "13px 16px" : "11px 16px",
          cursor: "pointer",
          borderLeft: `3px solid ${leftBorderColor}`,
          borderBottom: "1px solid var(--border)",
          background: bgColor,
          transition: "background 0.12s, border-color 0.12s",
          animation: `fadeUp 0.2s ease ${animDelay}s both`,
          position: "relative",
        }}
        onMouseEnter={e => { if (!isSelected && !isAnchor) e.currentTarget.style.background = "rgba(0,0,0,0.035)"; }}
        onMouseLeave={e => { if (!isSelected && !isAnchor) e.currentTarget.style.background = bgColor; }}
      >
        {/* Correlation thread line on left (inside border area) */}
        {isInGroup && !isSelected && (
          <div style={{
            position: "absolute",
            left: -1,
            top: isFirstInGroup ? "50%" : 0,
            bottom: isLastInGroup ? "50%" : 0,
            width: 3,
            background: correlationColor || "var(--border-hi)",
            opacity: 0.7,
          }} />
        )}

        {/* Timestamp column */}
        <div style={{
          width: 76, flexShrink: 0,
          fontFamily: "var(--font-mono)", fontSize: 11,
          color: "var(--muted)", paddingTop: 2, lineHeight: 1.3,
        }}>
          <div style={{ fontSize: 9, color: "var(--muted)", opacity: 0.8, marginBottom: 2, letterSpacing: 0.3 }}>
            {fmtDate(event.time)}
          </div>
          {fmtTime(event.time)}
          {/* Relative delta to T=0 */}
          {relativeLabel ? (
            <div style={{
              fontSize: 9, marginTop: 2, fontWeight: relativeLabel.weight,
              color: relativeLabel.color, letterSpacing: 0.2,
            }}>
              {relativeLabel.label}
            </div>
          ) : (
            <div style={{ fontSize: 9, color: "var(--muted)", opacity: 0.65, marginTop: 2 }}>
              {fmtTimeUTC(event.time)}
            </div>
          )}
        </div>

        {/* Severity dot */}
        <div style={{ paddingTop: 5, flexShrink: 0 }}>
          <SeverityDot severity={event.severity} />
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 4 }}>
            <SourceBadge source={event.source} />
            <span style={{
              color: sev.titleColor,
              fontSize: event.severity === "critical" ? 13.5 : 13,
              fontWeight: sev.titleWeight,
              lineHeight: 1.4,
            }}>
              {event.title}
            </span>

            {/* Recurrence badge */}
            {recurrence != null && (
              <span title={`This alarm fired ${recurrence}× in the last 7 days`} style={{
                fontSize: 9, fontFamily: "var(--font-mono)", fontWeight: 700,
                padding: "1px 6px", borderRadius: 99,
                background: recurrence >= 5 ? "rgba(220,38,38,0.12)" : "rgba(180,83,9,0.12)",
                border: `1px solid ${recurrence >= 5 ? "rgba(220,38,38,0.3)" : "rgba(180,83,9,0.3)"}`,
                color: recurrence >= 5 ? "var(--red)" : "var(--yellow)",
                whiteSpace: "nowrap",
              }}>
                ↺ {recurrence}× / 7d
              </span>
            )}
          </div>

          {event.detail && (
            <div style={{
              color: "var(--text-dim)", fontSize: 12, lineHeight: 1.55,
              marginBottom: event.tags?.length ? 6 : 0,
              overflow: "hidden", textOverflow: "ellipsis",
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            }}>
              {event.detail}
            </div>
          )}

          {event.tags?.length > 0 && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {event.tags.map(t => {
                const isActive = activeTagFilters.includes(t);
                return (
                  <span
                    key={t}
                    onClick={onTagClick ? (e) => { e.stopPropagation(); onTagClick(t); } : undefined}
                    title={onTagClick ? (isActive ? `Remove filter: ${t}` : `Filter by: ${t}`) : undefined}
                    style={{
                      padding: "1px 6px", borderRadius: 3,
                      fontSize: 10, fontFamily: "var(--font-mono)",
                      background: isActive ? "var(--blue)" : "var(--border)",
                      color: isActive ? "#fff" : "var(--text-dim)",
                      cursor: onTagClick ? "pointer" : "default",
                      transition: "background 0.1s, color 0.1s",
                      userSelect: "none",
                    }}
                    onMouseEnter={onTagClick ? (e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = "rgba(37,99,235,0.15)";
                        e.currentTarget.style.color = "var(--blue)";
                      }
                    } : undefined}
                    onMouseLeave={onTagClick ? (e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = "var(--border)";
                        e.currentTarget.style.color = "var(--text-dim)";
                      }
                    } : undefined}
                  >
                    #{t}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Chevron */}
        <div style={{
          flexShrink: 0, alignSelf: "center",
          fontSize: 16, color: "var(--border-hi)",
          paddingLeft: 4, lineHeight: 1, transition: "color 0.1s, transform 0.1s",
        }} className="event-chevron">›</div>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          isAnchor={isAnchor}
          onSetAnchor={() => { if (onSetAnchor) onSetAnchor(event.id); setCtxMenu(null); }}
          onClearAnchor={() => { if (onSetAnchor) onSetAnchor(null); setCtxMenu(null); }}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  );
}

function ContextMenu({ x, y, isAnchor, onSetAnchor, onClearAnchor, onClose }) {
  // Adjust position to stay in viewport
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    if (!menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    setPos({
      x: x + width  > vw ? Math.max(0, vw - width  - 8) : x,
      y: y + height > vh ? Math.max(0, vh - height - 8) : y,
    });
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 9999,
        background: "var(--surface)",
        border: "1px solid var(--border-hi)",
        borderRadius: 7,
        boxShadow: "0 8px 32px rgba(0,0,0,0.22)",
        minWidth: 180,
        overflow: "hidden",
        animation: "fadeIn 0.1s ease",
      }}
      onClick={e => e.stopPropagation()}
    >
      {!isAnchor ? (
        <MenuItem icon="⊙" label="Set as T=0 / incident start" color="var(--red)" onClick={onSetAnchor} />
      ) : (
        <MenuItem icon="✕" label="Clear T=0 anchor" color="var(--muted)" onClick={onClearAnchor} />
      )}
      <MenuItem icon="✕" label="Close menu" color="var(--muted)" onClick={onClose} />
    </div>
  );
}

function MenuItem({ icon, label, color, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 14px", cursor: "pointer",
        background: hover ? "var(--surface2)" : "transparent",
        transition: "background 0.1s",
      }}
    >
      <span style={{ fontSize: 12, color, flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 12, color: "var(--text)", fontFamily: "var(--font-sans)" }}>{label}</span>
    </div>
  );
}
