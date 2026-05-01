import { useState, useCallback } from "react";
import { api } from "../api.js";

export function useTimeline() {
  const [events,  setEvents]  = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [loaded,  setLoaded]  = useState(false);

  const load = useCallback(async (start, end, sources) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getTimeline(start, end, sources);
      // backend returns { events: [...] } or array directly
      const evts = Array.isArray(data) ? data : (data.events ?? []);
      setEvents(evts.sort((a, b) => new Date(a.time) - new Date(b.time)));
      setLoaded(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setEvents([]);
    setLoaded(false);
    setError(null);
  }, []);

  return { events, loading, error, loaded, load, reset };
}