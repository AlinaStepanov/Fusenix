import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useTimeline }     from "./hooks/useTimeline.js";
import { useSourceStatus } from "./hooks/useSourceStatus.js";
import { useAnalysis }     from "./hooks/useAnalysis.js";
import { TimelineEvent }   from "./components/TimelineEvent.jsx";
import { SourceFilter }    from "./components/SourceFilter.jsx";
import { EventDetail }     from "./components/EventDetail.jsx";
import { ErrorBanner }     from "./components/ErrorBanner.jsx";
import { Spinner }         from "./components/Spinner.jsx";
import { toInputValue }    from "./utils.js";

// ── Time range presets ────────────────────────────────────────────────────────

const PRESETS = [
  { label: "1h",  ms: 1  * 60 * 60 * 1000 },
  { label: "4h",  ms: 4  * 60 * 60 * 1000 },
  { label: "24h", ms: 24 * 60 * 60 * 1000 },
  { label: "7d",  ms: 7  * 24 * 60 * 60 * 1000 },
];

function makeRange(ms) {
  const end   = new Date();
  const start = new Date(end - ms);
  return { start: start.toISOString(), end: end.toISOString() };
}

// ── Main app ──────────────────────────────────────────────────────────────────

export default function App() {
  const { events, loading, error, load } = useTimeline();
  const { sources, loading: sourcesLoading } = useSourceStatus();
  const { analysis, loading: analysisLoading, error: analysisError, run: runAnalysis, clear: clearAnalysis } = useAnalysis();

  const [selectedEvent,  setSelectedEvent]  = useState(null);
  const [showAnalysis,   setShowAnalysis]   = useState(false);
  const [activeSources,  setActiveSources]  = useState(["cloudwatch", "github"]);
  const [activePreset,   setActivePreset]   = useState("4h");
  const [timeRange,      setTimeRange]      = useState(() => makeRange(4 * 60 * 60 * 1000));
  const [bannerError,    setBannerError]    = useState(null);

  // Dismiss banner when new load starts
  useEffect(() => { setBannerError(null); }, [timeRange, activeSources]);

  // Load events whenever time range or sources change
  useEffect(() => {
    load(timeRange.start, timeRange.end, activeSources);
  }, [timeRange, activeSources]); // eslint-disable-line react-hooks/exhaustive-deps

  // Surface load errors to the banner
  useEffect(() => {
    if (error) setBannerError(error);
  }, [error]);

  const handlePreset = useCallback((preset) => {
    setActivePreset(preset.label);
    setTimeRange(makeRange(preset.ms));
  }, []);

  const handleCustomStart = useCallback((val) => {
    if (!val) return;
    setActivePreset(null);
    setTimeRange(r => ({ ...r, start: new Date(val).toISOString() }));
  }, []);

  const handleCustomEnd = useCallback((val) => {
    if (!val) return;
    setActivePreset(null);
    setTimeRange(r => ({ ...r, end: new Date(val).toISOString() }));
  }, []);

  const handleSourceToggle = useCallback((source) => {
    setActiveSources(prev =>
      prev.includes(source)
        ? prev.filter(s => s !== source)
        : [...prev, source]
    );
  }, []);

  const handleAnalyze = useCallback(() => {
    setShowAnalysis(true);
    setSelectedEvent(null);
    runAnalysis(visibleEvents);
  }, [events, activeSources]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(visibleEvents, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `opsbridge-${new Date().toISOString().slice(0,16)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [events, activeSources]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply source filter for display
  const visibleEvents = useMemo(
    () => events.filter(e => activeSources.includes(e.source)),
    [events, activeSources]
  );

  // Stats for the header strip
  const stats = useMemo(() => {
    const c = { critical: 0, warning: 0, info: 0, success: 0 };
    for (const e of visibleEvents) c[e.severity] = (c[e.severity] || 0) + 1;
    return c;
  }, [visibleEvents]);

  const hasPanel = selectedEvent || showAnalysis;

  return (
    <div style={{
      height: "100vh", display: "flex", flexDirection: "column",
      background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-sans)",
      overflow: "hidden",
    }}>

      {/* ── Header ── */}
      <header style={{
        padding: "10px 20px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
        flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{ marginRight: 8 }}>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.5, lineHeight: 1 }}>
            OpsBridge
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
            incident context aggregator
          </div>
        </div>

        {/* Preset buttons */}
        <div style={{
          display: "flex", gap: 3,
          background: "var(--bg)", borderRadius: 6, padding: 3,
          border: "1px solid var(--border)",
        }}>
          {PRESETS.map(p => (
            <button key={p.label} onClick={() => handlePreset(p)} style={{
              padding: "3px 11px", borderRadius: 4, border: "none",
              fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600,
              background: activePreset === p.label ? "var(--surface)" : "transparent",
              color: activePreset === p.label ? "var(--green)" : "var(--muted)",
              cursor: "pointer", transition: "all 0.1s",
              boxShadow: activePreset === p.label ? "0 1px 3px rgba(0,0,0,0.4)" : "none",
            }}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Separator */}
        <span style={{ color: "var(--border-hi)", fontSize: 13 }}>|</span>

        {/* Custom datetime range */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="datetime-local"
            value={toInputValue(timeRange.start)}
            onChange={e => handleCustomStart(e.target.value)}
            style={inputStyle}
          />
          <span style={{ color: "var(--muted)", fontSize: 11 }}>→</span>
          <input
            type="datetime-local"
            value={toInputValue(timeRange.end)}
            onChange={e => handleCustomEnd(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Stats strip */}
        {visibleEvents.length > 0 && (
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <StatPill label="total"    value={visibleEvents.length} color="var(--text-dim)" />
            {stats.critical > 0 && <StatPill label="crit"  value={stats.critical} color="var(--red)"    />}
            {stats.warning  > 0 && <StatPill label="warn"  value={stats.warning}  color="var(--yellow)" />}
            {stats.info     > 0 && <StatPill label="info"  value={stats.info}     color="var(--blue)"   />}
            {stats.success  > 0 && <StatPill label="ok"    value={stats.success}  color="var(--green)"  />}
          </div>
        )}

        {/* Separator */}
        <span style={{ color: "var(--border-hi)", fontSize: 13 }}>|</span>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 6 }}>
          {/* AI Analysis */}
          <button
            onClick={handleAnalyze}
            disabled={visibleEvents.length === 0 || analysisLoading}
            title={visibleEvents.length === 0 ? "Load events first" : "Run AI root-cause analysis"}
            style={{
              ...btnStyle,
              background: showAnalysis ? "rgba(0,229,160,0.12)" : "transparent",
              border: `1px solid ${showAnalysis ? "rgba(0,229,160,0.4)" : "var(--border-hi)"}`,
              color: showAnalysis ? "var(--green)" : "var(--muted)",
              opacity: visibleEvents.length === 0 ? 0.4 : 1,
            }}
          >
            {analysisLoading ? <Spinner size={11} /> : <span>◈</span>}
            {analysisLoading ? "Analyzing…" : "AI Analysis"}
          </button>

          {/* Export */}
          <button
            onClick={handleExport}
            disabled={visibleEvents.length === 0}
            title="Export visible events as JSON"
            style={{
              ...btnStyle,
              opacity: visibleEvents.length === 0 ? 0.4 : 1,
            }}
          >
            ↓ Export
          </button>

          {/* Refresh */}
          <button
            onClick={() => load(timeRange.start, timeRange.end, activeSources)}
            disabled={loading}
            title="Refresh timeline"
            style={btnStyle}
          >
            {loading ? <Spinner size={11} color="var(--muted)" /> : "↺"}
            {!loading && " Refresh"}
          </button>
        </div>
      </header>

      {/* ── Source filter bar ── */}
      <SourceFilter
        events={events}
        activeSources={activeSources}
        onToggle={handleSourceToggle}
        sources={sources}
        loading={sourcesLoading}
      />

      {/* ── Error banner ── */}
      {bannerError && (
        <div style={{ padding: "8px 20px", flexShrink: 0 }}>
          <ErrorBanner
            error={bannerError}
            onDismiss={() => setBannerError(null)}
            onRetry={() => load(timeRange.start, timeRange.end, activeSources)}
          />
        </div>
      )}

      {/* ── Main content area ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Timeline */}
        <section style={{
          flex: 1,
          overflowY: "auto",
          borderRight: hasPanel ? "1px solid var(--border)" : "none",
          minWidth: 0,
        }}>
          {loading && visibleEvents.length === 0 ? (
            <EmptyState loading />
          ) : !loading && visibleEvents.length === 0 && !error ? (
            <EmptyState />
          ) : (
            <div>
              {visibleEvents.map((event, i) => (
                <TimelineEvent
                  key={event.id || i}
                  event={event}
                  isSelected={selectedEvent?.id === event.id}
                  onClick={() => {
                    setSelectedEvent(event);
                    setShowAnalysis(false);
                  }}
                  animDelay={Math.min(i * 0.01, 0.25)}
                />
              ))}
              <div style={{ height: 40 }} />
            </div>
          )}
        </section>

        {/* Event detail panel */}
        {selectedEvent && !showAnalysis && (
          <aside style={{ width: 420, flexShrink: 0, overflowY: "auto" }}>
            <EventDetail
              event={selectedEvent}
              onClose={() => setSelectedEvent(null)}
            />
          </aside>
        )}

        {/* AI Analysis panel */}
        {showAnalysis && (
          <aside style={{ width: 460, flexShrink: 0, overflowY: "auto", background: "var(--surface)" }}>
            <AnalysisPanel
              analysis={analysis}
              loading={analysisLoading}
              error={analysisError}
              eventCount={visibleEvents.length}
              onClose={() => { setShowAnalysis(false); clearAnalysis(); }}
              onRetry={() => runAnalysis(visibleEvents)}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const inputStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border-hi)",
  borderRadius: 5,
  padding: "4px 8px",
  color: "var(--text-dim)",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  outline: "none",
};

const btnStyle = {
  display: "inline-flex", alignItems: "center", gap: 5,
  padding: "5px 11px", borderRadius: 6,
  background: "transparent", border: "1px solid var(--border-hi)",
  color: "var(--muted)", fontSize: 11,
  fontFamily: "var(--font-mono)", fontWeight: 600,
  cursor: "pointer", transition: "all 0.12s",
  whiteSpace: "nowrap",
};

// ── Helper components ─────────────────────────────────────────────────────────

function StatPill({ label, value, color }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 15, color }}>{value}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
    </div>
  );
}

function EmptyState({ loading }) {
  return (
    <div style={{ padding: 80, textAlign: "center" }}>
      {loading ? (
        <>
          <Spinner size={28} />
          <p style={{ color: "var(--muted)", marginTop: 20, fontSize: 13 }}>Loading events…</p>
        </>
      ) : (
        <>
          <div style={{ fontSize: 36, marginBottom: 14, opacity: 0.3 }}>◎</div>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>No events found</p>
          <p style={{ color: "var(--border-hi)", fontSize: 12, marginTop: 6 }}>
            Try expanding the time range or check your source configuration.
          </p>
        </>
      )}
    </div>
  );
}

// ── AI Analysis panel ─────────────────────────────────────────────────────────

function AnalysisPanel({ analysis, loading, error, eventCount, onClose, onRetry }) {
  const a = analysis?.analysis;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{
        padding: "13px 18px",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 8,
        flexShrink: 0,
      }}>
        <span style={{ color: "var(--green)", fontSize: 13 }}>◈</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600 }}>
          AI Root-Cause Analysis
        </span>
        {!loading && !error && a && (
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)",
            marginLeft: 4,
          }}>
            ({eventCount} events)
          </span>
        )}
        <button
          onClick={onClose}
          style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer", lineHeight: 1 }}
          onMouseEnter={e => e.target.style.color = "var(--text)"}
          onMouseLeave={e => e.target.style.color = "var(--muted)"}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 18px 32px" }}>

        {loading && (
          <div style={{ textAlign: "center", paddingTop: 60 }}>
            <Spinner size={28} />
            <p style={{ color: "var(--muted)", marginTop: 20, fontSize: 13 }}>
              Analyzing {eventCount} events…
            </p>
            <p style={{ color: "var(--border-hi)", fontSize: 11, marginTop: 6, fontFamily: "var(--font-mono)" }}>
              Claude is reading the incident timeline
            </p>
          </div>
        )}

        {error && !loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <ErrorBanner error={error} />
            <button onClick={onRetry} style={{ ...btnStyle, alignSelf: "flex-start" }}>
              ↺ Retry analysis
            </button>
          </div>
        )}

        {a && !loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Risk score */}
            <div style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "14px 16px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}>
              <div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                  Risk Score
                </div>
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: 28, fontWeight: 700, lineHeight: 1,
                  color: a.risk_score >= 7 ? "var(--red)" : a.risk_score >= 4 ? "var(--yellow)" : "var(--green)",
                }}>
                  {a.risk_score}
                  <span style={{ fontSize: 14, color: "var(--muted)", fontWeight: 400 }}>/10</span>
                </div>
              </div>
              <div style={{
                flex: 1, height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden",
              }}>
                <div style={{
                  height: "100%", borderRadius: 3,
                  width: `${(a.risk_score / 10) * 100}%`,
                  background: a.risk_score >= 7 ? "var(--red)" : a.risk_score >= 4 ? "var(--yellow)" : "var(--green)",
                  transition: "width 0.5s ease",
                }} />
              </div>
            </div>

            <ASection title="Root Cause"       content={a.root_cause}        accent="var(--red)"    />
            <ASection title="Key Insight"      content={a.key_insight}       accent="var(--blue)"   />
            <ASection title="Timeline Summary" content={a.timeline_summary}  accent="var(--purple)" />

            {a.contributing_factors?.length > 0 && (
              <div>
                <ALabel>Contributing Factors</ALabel>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {a.contributing_factors.map((f, i) => (
                    <div key={i} style={{ display: "flex", gap: 8 }}>
                      <span style={{ fontFamily: "var(--font-mono)", color: "var(--yellow)", flexShrink: 0, fontSize: 11, paddingTop: 2 }}>▸</span>
                      <span style={{ color: "var(--text-dim)", fontSize: 13, lineHeight: 1.55 }}>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {a.next_steps?.length > 0 && (
              <div>
                <ALabel>Next Steps</ALabel>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {a.next_steps.map((s, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span style={{
                        fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--green)",
                        background: "rgba(0,229,160,0.1)", border: "1px solid rgba(0,229,160,0.2)",
                        borderRadius: 4, padding: "1px 6px", flexShrink: 0, marginTop: 2,
                      }}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span style={{ color: "var(--text-dim)", fontSize: 13, lineHeight: 1.55 }}>{s}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ALabel({ children }) {
  return (
    <div style={{
      fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)",
      textTransform: "uppercase", letterSpacing: 1, marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

function ASection({ title, content, accent }) {
  if (!content) return null;
  return (
    <div>
      <ALabel>{title}</ALabel>
      <div style={{
        padding: "11px 14px",
        background: "var(--bg)",
        borderRadius: "0 6px 6px 0",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${accent}`,
        fontSize: 13, lineHeight: 1.65, color: "var(--text)",
      }}>
        {content}
      </div>
    </div>
  );
}
