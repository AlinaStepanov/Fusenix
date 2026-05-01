import { useState, useEffect } from "react";
import { api } from "../api.js";

// FIX: was exported as useSourcesStatus (plural) — renamed to match import in App.jsx
export function useSourceStatus() {
  const [sources,  setSources]  = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.sourcesStatus()
      .then(setSources)
      .catch(() => setSources({}))
      .finally(() => setLoading(false));
  }, []);

  return { sources, loading };
}
