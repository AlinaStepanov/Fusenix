import { SOURCE_META } from "../constants.js";

export function SourceBadge({ source, small }) {
  const m = SOURCE_META[source] ?? { label: source, color: "#4a5568", icon: "?" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: small ? "1px 6px" : "2px 8px",
      borderRadius: 4,
      background: m.color + "18",
      border: `1px solid ${m.color}44`,
      color: m.color,
      fontSize: small ? 10 : 11,
      fontFamily: "var(--font-mono)",
      fontWeight: 600,
      whiteSpace: "nowrap",
      flexShrink: 0,
    }}>
      <span style={{ fontSize: small ? 9 : 10 }}>{m.icon}</span>
      {m.label}
    </span>
  );
}