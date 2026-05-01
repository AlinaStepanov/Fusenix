import { useMemo, useRef, useState, useCallback } from "react";

const BUCKET_COUNT = 48;

const SEV_RANK  = { critical: 3, warning: 2, info: 1, success: 0 };
const SEV_COLOR = {
  critical: "var(--red)",
  warning:  "var(--yellow)",
  info:     "var(--blue)",
  success:  "var(--green)",
};

function fmtRangeLabel(iso, rangeMs) {
  const timeStr = new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
  if (rangeMs > 24 * 60 * 60 * 1000) {
    const dateStr = new Date(iso).toLocaleDateString("en-US", {
      month: "short", day: "numeric",
    });
    return `${dateStr} ${timeStr}`;
  }
  return timeStr;
}

export function DensityBar({ events = [], timeRange, onZoom }) {
  const rangeMs = timeRange?.start && timeRange?.end
    ? new Date(timeRange.end) - new Date(timeRange.start)
    : 0;

  const barRef       = useRef(null);
  const [hoverIdx,   setHoverIdx]   = useState(null);
  const [barHovered, setBarHovered]  = useState(false);
  const [dragStart,  setDragStart]  = useState(null);   // bucket index
  const [dragEnd,    setDragEnd]    = useState(null);   // bucket index

  const { buckets, maxCount, totalEvents } = useMemo(() => {
    if (!timeRange?.start || !timeRange?.end) {
      return { buckets: Array(BUCKET_COUNT).fill({ count: 0, severity: null }), maxCount: 1, totalEvents: 0 };
    }

    const start    = new Date(timeRange.start).getTime();
    const end      = new Date(timeRange.end).getTime();
    const bucketMs = Math.max(1, (end - start) / BUCKET_COUNT);

    const buckets = Array.from({ length: BUCKET_COUNT }, () => ({ count: 0, severity: null }));

    for (const ev of events) {
      const t = new Date(ev.time).getTime();
      if (t < start || t > end) continue;
      const idx        = Math.min(Math.floor((t - start) / bucketMs), BUCKET_COUNT - 1);
      buckets[idx].count++;
      const evRank  = SEV_RANK[ev.severity]             ?? -1;
      const curRank = SEV_RANK[buckets[idx].severity]   ?? -1;
      if (evRank > curRank) buckets[idx].severity = ev.severity;
    }

    const maxCount    = Math.max(1, ...buckets.map(b => b.count));
    const totalEvents = buckets.reduce((s, b) => s + b.count, 0);
    return { buckets, maxCount, totalEvents };
  }, [events, timeRange]);

  if (!timeRange?.start || !timeRange?.end) return null;

  // ── helpers ──────────────────────────────────────────────────────────────

  const bucketIdxFromEvent = useCallback((e) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = e.clientX - rect.left;
    return Math.max(0, Math.min(BUCKET_COUNT - 1, Math.floor((x / rect.width) * BUCKET_COUNT)));
  }, []);

  const commitZoom = useCallback((idxA, idxB) => {
    if (!onZoom) return;
    const start  = new Date(timeRange.start).getTime();
    const end    = new Date(timeRange.end).getTime();
    const bucket = (end - start) / BUCKET_COUNT;

    const lo = Math.min(idxA, idxB);
    const hi = Math.max(idxA, idxB);

    // Single bucket click: zoom to ±4 buckets for context, min 5 min
    if (lo === hi) {
      const center   = start + (lo + 0.5) * bucket;
      const halfSpan = Math.max(4 * bucket, 5 * 60 * 1000);
      onZoom(
        new Date(center - halfSpan).toISOString(),
        new Date(center + halfSpan).toISOString()
      );
    } else {
      // Drag: zoom to exact selected span
      onZoom(
        new Date(start + lo * bucket).toISOString(),
        new Date(start + (hi + 1) * bucket).toISOString()
      );
    }
  }, [timeRange, onZoom]);

  // ── mouse handlers ───────────────────────────────────────────────────────

  const onMouseDown = useCallback((e) => {
    if (!onZoom) return;
    e.preventDefault();
    const idx = bucketIdxFromEvent(e);
    if (idx === null) return;
    setDragStart(idx);
    setDragEnd(idx);
  }, [onZoom, bucketIdxFromEvent]);

  const onMouseMove = useCallback((e) => {
    const idx = bucketIdxFromEvent(e);
    if (idx === null) return;
    setHoverIdx(idx);
    if (dragStart !== null) setDragEnd(idx);
  }, [bucketIdxFromEvent, dragStart]);

  const onMouseUp = useCallback((e) => {
    if (dragStart === null) return;
    const idx = bucketIdxFromEvent(e) ?? dragStart;
    commitZoom(dragStart, idx);
    setDragStart(null);
    setDragEnd(null);
  }, [dragStart, bucketIdxFromEvent, commitZoom]);

  const onMouseLeave = useCallback(() => {
    setHoverIdx(null);
    if (dragStart !== null) {
      setDragStart(null);
      setDragEnd(null);
    }
  }, [dragStart]);

  // ── selection range for highlight ────────────────────────────────────────
  const selLo = dragStart !== null ? Math.min(dragStart, dragEnd ?? dragStart) : null;
  const selHi = dragStart !== null ? Math.max(dragStart, dragEnd ?? dragStart) : null;

  const isDragging = dragStart !== null && dragEnd !== null && dragEnd !== dragStart;

  return (
    <div style={{
      padding: "8px 20px 5px",
      borderBottom: "1px solid var(--border)",
      background: "var(--surface)",
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", letterSpacing: 0.5 }}>
            Event density
          </span>
          {onZoom && barHovered && !isDragging && (
            <span style={{
              fontSize: 10, color: "var(--blue)", fontFamily: "var(--font-mono)",
              background: "rgba(55,138,221,0.08)", border: "1px solid rgba(55,138,221,0.22)",
              borderRadius: 4, padding: "0px 6px",
            }}>drag to select</span>
          )}
          {onZoom && isDragging && selLo !== null && (
            <span style={{
              fontSize: 10, color: "var(--green)", fontFamily: "var(--font-mono)",
              background: "rgba(99,153,34,0.08)", border: "1px solid rgba(99,153,34,0.22)",
              borderRadius: 4, padding: "0px 6px",
            }}>
              {(() => {
                const s0  = new Date(timeRange.start).getTime();
                const e0  = new Date(timeRange.end).getTime();
                const bms = (e0 - s0) / BUCKET_COUNT;
                const lo  = Math.min(selLo, selHi ?? selLo);
                const hi  = Math.max(selLo, selHi ?? selLo);
                const ds  = new Date(s0 + lo * bms);
                const de  = new Date(s0 + (hi + 1) * bms);
                const fmt = d => d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
                return `${fmt(ds)} → ${fmt(de)}`;
              })()}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)" }}>
            {totalEvents} event{totalEvents !== 1 ? "s" : ""}
          </span>
          {onZoom && (
            <div style={{
              width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
              border: `1.5px solid ${barHovered ? "var(--blue)" : "var(--border-hi)"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "border-color 0.15s",
            }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                stroke={barHovered ? "var(--blue)" : "var(--muted)"} strokeWidth="1.5"
                style={{ transition: "stroke 0.15s" }}>
                <circle cx="4" cy="4" r="2.5"/>
                <line x1="6.2" y1="6.2" x2="9" y2="9"/>
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* bar area */}
      <div
        ref={barRef}
        onMouseEnter={() => setBarHovered(true)}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        style={{
          display: "flex", alignItems: "flex-end", gap: "1.5px", height: 28,
          cursor: onZoom ? (isDragging ? "col-resize" : "pointer") : "default",
          userSelect: "none",
          position: "relative",
        }}
      >
        {buckets.map((b, i) => {
          const pct    = b.count === 0 ? 0 : b.count / maxCount;
          const height = b.count === 0 ? 2 : Math.max(3, Math.round(pct * 26));

          const isHovered  = hoverIdx === i && dragStart === null;
          const isSelected = selLo !== null && i >= selLo && i <= selHi;

          const baseColor = b.count === 0
            ? "var(--border)"
            : (SEV_COLOR[b.severity] ?? "var(--border-hi)");

          return (
            <div
              key={i}
              title={b.count > 0 ? `${b.count} event${b.count !== 1 ? "s" : ""}` : undefined}
              style={{
                flex: 1,
                height: isHovered ? Math.max(height, 8) : height,
                borderRadius: "1px 1px 0 0",
                background: isSelected ? "var(--blue)" : baseColor,
                opacity: isSelected ? 0.75 : isHovered ? 1 : b.count === 0 ? 0.35 : 0.82,
                minWidth: 2,
                transition: "height 0.08s, opacity 0.08s",
              }}
            />
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--muted)" }}>{fmtRangeLabel(timeRange.start, rangeMs)}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--muted)" }}>{fmtRangeLabel(timeRange.end, rangeMs)}</span>
      </div>
    </div>
  );
}
