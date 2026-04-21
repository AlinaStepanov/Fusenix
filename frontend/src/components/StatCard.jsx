export function StatCard({ label, value, color, sub }) {
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      padding: "14px 18px",
      flex: 1,
      minWidth: 120,
    }}>
      <div style={{
        color: "var(--muted)", fontSize: 10,
        fontFamily: "var(--font-mono)", letterSpacing: 1,
        textTransform: "uppercase", marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{
        color: color || "var(--text)",
        fontSize: 24, fontWeight: 700,
        fontFamily: "var(--font-mono)",
        lineHeight: 1,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 5 }}>
          {sub}
        </div>
      )}
    </div>
  );
}