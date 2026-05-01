export function Spinner({ color = "var(--green)", size = 16 }) {
  return (
    <span style={{
      display: "inline-block",
      width: size, height: size,
      border: `2px solid transparent`,
      borderTopColor: color,
      borderRadius: "50%",
      animation: "spin 0.7s linear infinite",
      flexShrink: 0,
    }} />
  );
}