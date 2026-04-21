import { useState, useCallback } from "react";
import { api } from "../api.js";

export function useAnalysis() {
  const [analysis, setAnalysis] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  const run = useCallback(async (events) => {
    if (!events.length) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    try {
      const data = await api.analyze(events);
      setAnalysis(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setAnalysis(null);
    setError(null);
  }, []);

  return { analysis, loading, error, run, clear };
}