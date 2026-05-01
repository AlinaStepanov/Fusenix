import { SEVERITY } from "../constants.js";

/**
 * Shape + colour severity indicator — readable in all colour-vision modes.
 *   critical → circle  (red)
 *   warning  → triangle (amber)
 *   info     → square   (blue)
 *   success  → diamond  (green)
 */
export function SeverityDot({ severity, size = 10 }) {
  const s = SEVERITY[severity] ?? { color: "#4a5568" };
  const c = s.color;

  if (severity === "warning") {
    return (
      <svg width={size} height={size} viewBox="0 0 10 10" style={{ flexShrink: 0, display: "block" }}>
        <polygon points="5,0.8 9.5,9.2 0.5,9.2" fill={c} />
      </svg>
    );
  }
  if (severity === "info") {
    return (
      <svg width={size} height={size} viewBox="0 0 10 10" style={{ flexShrink: 0, display: "block" }}>
        <rect x="1" y="1" width="8" height="8" rx="1.5" fill={c} />
      </svg>
    );
  }
  if (severity === "success") {
    return (
      <svg width={size} height={size} viewBox="0 0 10 10" style={{ flexShrink: 0, display: "block" }}>
        <polygon points="5,0.5 9.5,5 5,9.5 0.5,5" fill={c} />
      </svg>
    );
  }
  // critical (default) → circle, with subtle glow
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" style={{ flexShrink: 0, display: "block" }}>
      <circle cx="5" cy="5" r="4.5" fill={c} />
    </svg>
  );
}

export function SeverityTag({ severity }) {
  const s = SEVERITY[severity] ?? { color: "#4a5568", label: "?" };
  return (
    <span style={{
      padding: "1px 7px", borderRadius: 4,
      fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 700,
      color: s.color,
      background: s.color + "18",
      border: `1px solid ${s.color}44`,
      letterSpacing: 0.5,
    }}>
      {s.label}
    </span>
  );
}
