export function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

export function fmtDatetime(iso) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

export function durationMin(start, end) {
  return Math.round((new Date(end) - new Date(start)) / 60000);
}

/**
 * FIX: was using .toISOString().slice(0,16) which gives UTC time.
 * datetime-local inputs expect LOCAL time, not UTC, so the picker
 * would show the wrong value for users outside UTC.
 */
export function toInputValue(isoOrDate) {
  const d = new Date(isoOrDate);
  const pad = n => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export function groupByDate(events) {
  const groups = {};
  for (const e of events) {
    const key = fmtDate(e.time);
    if (\!groups[key]) groups[key] = [];
    groups[key].push(e);
  }
  return groups;
}
