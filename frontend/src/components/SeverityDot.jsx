import { SEVERITY } from "../constants.js";

export function SeverityDot({ severity, size = 8 }) {
  const s = SEVERITY[severity] ?? { color: "#4a5568" };
  return (
    <span style={{
      display: "inline-block",
      width: size, height: size,
      borderRadius: "50%",
      flexShrink: 0,
      background: s.color,
      boxShadow: severity === "critical" ? `0 0 7px ${s.color}` : "none",
    }} />
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