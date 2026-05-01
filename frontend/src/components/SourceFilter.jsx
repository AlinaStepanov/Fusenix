import { SOURCE_META } from "../constants.js";

/**
 * FIX: was expecting { events, activeFilters (Set), onToggle, sourcesStatus }
 * Now accepts { events (array), activeSources (array), onToggle, sources (obj), loading }
 * which matches what App.jsx passes.
 */
export function SourceFilter({ events = [], activeSources = [], onToggle, sources = {}, loading }) {
  // Count events per source from the current timeline
  const countBySource = {};
  for (const e of events) {
    countBySource[e.source] = (countBySource[e.source] || 0) + 1;
  }

  return (
    <div style={{
      padding: "8px 20px",
      borderBottom: "1px solid var(--border)",
      background: "var(--surface)",
      display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap",
    }}>
      <span style={{
        color: "var(--muted)", fontSize: 10,
        fontFamily: "var(--font-mono)", letterSpacing: 1,
        textTransform: "uppercase", marginRight: 4, flexShrink: 0,
      }}>
        Sources
      </span>

      {loading && (
        <span style={{ color: "var(--muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
          checking...
        </span>
      )}

      {Object.entries(SOURCE_META).map(([key, m]) => {
        // FIX: activeSources is an array, not a Set — use .includes()
        const active      = activeSources.includes(key);
        const count       = countBySource[key] ?? 0;
        const sourceInfo  = sources[key];
        // A source is "enabled" if the backend says it's configured, or if we have no info yet
        const configured  = sourceInfo ? sourceInfo.configured !== false : null;
        const isAvailable = configured !== false;

        return (
          <button
            key={key}
            onClick={() => onToggle(key)}
            title={
              configured === false
                ? `${m.label} not configured — add credentials to .env`
                : active ? `Hide ${m.label} events` : `Show ${m.label} events`
            }
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "3px 10px", borderRadius: 5,
              background: active ? m.color + "18" : "transparent",
              border: `1px solid ${active ? m.color + "66" : "var(--border)"}`,
              color: active ? m.color : "var(--muted)",
              fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600,
              transition: "all 0.12s",
              opacity: isAvailable ? 1 : 0.4,
              cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 10 }}>{m.icon}</span>
            {m.label}
            {count > 0 && (
              <span style={{
                background: active ? m.color + "30" : "var(--border)",
                borderRadius: 10, padding: "0 5px", fontSize: 10,
                color: active ? m.color : "var(--muted)",
              }}>
                {count}
              </span>
            )}
            {configured === false && (
              <span style={{ fontSize: 9, opacity: 0.7 }}>✕</span>
            )}
            {configured === true && (
              <span style={{ fontSize: 8, color: "var(--green)", opacity: 0.8 }}>●</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
