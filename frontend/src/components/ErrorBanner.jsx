/**
 * FIX: was only accepting { message, onDismiss }.
 * Now also accepts { error, onRetry } to match how App.jsx calls it.
 */
export function ErrorBanner({ message, error, onDismiss, onRetry }) {
  const text = message || error;
  if (!text) return null;

  const handleDismiss = onDismiss || onRetry;

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      padding: "10px 14px",
      background: "rgba(255,77,106,0.08)",
      border: "1px solid rgba(255,77,106,0.25)",
      borderRadius: 6,
      color: "var(--red)",
      fontSize: 12,
      fontFamily: "var(--font-mono)",
      animation: "fadeIn 0.2s ease",
      lineHeight: 1.5,
    }}>
      <span style={{ flexShrink: 0, fontSize: 13, paddingTop: 1 }}>⚠</span>
      <span style={{ flex: 1, wordBreak: "break-word" }}>{text}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            background: "rgba(255,77,106,0.15)",
            border: "1px solid rgba(255,77,106,0.3)",
            borderRadius: 4,
            color: "var(--red)", fontSize: 11,
            cursor: "pointer", padding: "2px 8px", flexShrink: 0,
          }}
        >
          Retry
        </button>
      )}
      {handleDismiss && !onRetry && (
        <button
          onClick={handleDismiss}
          style={{ background: "none", border: "none", color: "var(--red)", fontSize: 16, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}
        >
          ×
        </button>
      )}
    </div>
  );
}
