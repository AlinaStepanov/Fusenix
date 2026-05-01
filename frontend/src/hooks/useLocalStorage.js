/**
 * useLocalStorage — drop-in replacement for useState that persists to localStorage.
 *
 * Usage:
 *   const [value, setValue] = useLocalStorage("my-key", defaultValue);
 *
 * - Serialises/deserialises with JSON automatically.
 * - Falls back gracefully if localStorage is unavailable (e.g. private browsing quotas).
 * - `setValue` accepts both a new value OR an updater function (same API as useState).
 */
import { useState, useCallback } from "react";

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or private-browsing restriction — degrade silently
  }
}

export function useLocalStorage(key, initialValue) {
  const [state, setStateRaw] = useState(() => readStorage(key, initialValue));

  const setState = useCallback(
    (valueOrUpdater) => {
      setStateRaw((prev) => {
        const next =
          typeof valueOrUpdater === "function"
            ? valueOrUpdater(prev)
            : valueOrUpdater;
        writeStorage(key, next);
        return next;
      });
    },
    [key]
  );

  return [state, setState];
}
