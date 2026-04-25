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
import { api }              from "./api.js";

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
  const [showAlarmAudit, setShowAlarmAudit] = useState(false);
  const [alarmAudit,     setAlarmAudit]     = useState(null);
  const [auditLoading,   setAuditLoading]   = useState(false);
  const [auditError,     setAuditError]     = useState(null);
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

  const handleAlarmAudit = useCallback(async () => {
    setShowAlarmAudit(true);
    setShowAnalysis(false);
    setSelectedEvent(null);
    setAuditError(null);
    if (alarmAudit) return; // already loaded — show cached result
    setAuditLoading(true);
    try {
      const data = await api.auditAlarms();
      setAlarmAudit(data);
    } catch (e) {
      setAuditError(e.message || "Alarm audit failed");
    } finally {
      setAuditLoading(false);
    }
  }, [alarmAudit]);

  const handleAlarmAuditRefresh = useCallback(async () => {
    setAlarmAudit(null);
    setAuditError(null);
    setAuditLoading(true);
    try {
      const data = await api.auditAlarms();
      setAlarmAudit(data);
    } catch (e) {
      setAuditError(e.message || "Alarm audit failed");
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(visibleEvents, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `Fusenix-${new Date().toISOString().slice(0,16)}.json`;
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

  const hasPanel = selectedEvent || showAnalysis || showAlarmAudit;

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
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}>
        {/* Logo */}
        <div style={{ marginRight: 8 }}>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.5, lineHeight: 1, color: "var(--text)" }}>
            Fusenix
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
              color: activePreset === p.label ? "var(--blue)" : "var(--muted)",
              cursor: "pointer", transition: "all 0.1s",
              boxShadow: activePreset === p.label ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
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
          {/* Alarm Audit */}
          <button
            onClick={handleAlarmAudit}
            title="Inspect CloudWatch alarm configurations for misconfigurations"
            style={{
              ...btnStyle,
              background: showAlarmAudit ? "rgba(234,179,8,0.1)" : "transparent",
              border: `1px solid ${showAlarmAudit ? "rgba(234,179,8,0.4)" : "var(--border-hi)"}`,
              color: showAlarmAudit ? "var(--yellow)" : "var(--muted)",
            }}
          >
            {auditLoading ? <Spinner size={11} color="var(--yellow)" /> : <span>⚙</span>}
            {auditLoading ? "Auditing…" : "Alarm Audit"}
          </button>

          {/* AI Analysis */}
          <button
            onClick={handleAnalyze}
            disabled={visibleEvents.length === 0 || analysisLoading}
            title={visibleEvents.length === 0 ? "Load events first" : "Run AI root-cause analysis"}
            style={{
              ...btnStyle,
              background: showAnalysis ? "rgba(5,150,105,0.1)" : "transparent",
              border: `1px solid ${showAnalysis ? "rgba(5,150,105,0.35)" : "var(--border-hi)"}`,
              color: showAnalysis ? "var(--green)" : "var(--muted)",
              opacity: visibleEvents.length === 0 ? 0.4 : 1,
            }}
          >
            {analysisLoading ? <Spinner size={11} color="var(--green)" /> : <span>◈</span>}
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
          background: "var(--surface)",
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

        {/* Alarm Audit panel */}
        {showAlarmAudit && !showAnalysis && !selectedEvent && (
          <aside style={{ width: 500, flexShrink: 0, overflowY: "auto", background: "var(--surface)" }}>
            <AlarmAuditPanel
              data={alarmAudit}
              loading={auditLoading}
              error={auditError}
              onClose={() => setShowAlarmAudit(false)}
              onRefresh={handleAlarmAuditRefresh}
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
  color: "var(--text-dim)", fontSize: 11,
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
          <Spinner size={28} color="var(--blue)" />
          <p style={{ color: "var(--muted)", marginTop: 20, fontSize: 13 }}>Loading events…</p>
        </>
      ) : (
        <>
          <div style={{ fontSize: 36, marginBottom: 14, opacity: 0.2, color: "var(--text)" }}>◎</div>
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
        background: "var(--surface)",
      }}>
        <span style={{ color: "var(--green)", fontSize: 13 }}>◈</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
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
            <Spinner size={28} color="var(--blue)" />
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
                        background: "rgba(5,150,105,0.1)", border: "1px solid rgba(5,150,105,0.25)",
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

// ── Alarm Audit Panel ─────────────────────────────────────────────────────────

const HEALTH_COLOR = {
  critical: "var(--red)",
  warning:  "var(--yellow)",
  info:     "var(--blue)",
  ok:       "var(--green)",
};

const HEALTH_ICON = { critical: "✕", warning: "⚠", info: "ℹ", ok: "✓" };

const ISSUE_COLOR = { critical: "var(--red)", warning: "var(--yellow)", info: "var(--blue)" };

// Maps backend issue codes → human title + explanation + fix snippet
const ISSUE_META = {
  NO_ALARM_ACTION: {
    title: "No alarm action configured",
    description: "This alarm fires silently. When the metric breaches threshold, nobody is notified — incidents go undetected until users report them.",
    fix:
`aws cloudwatch put-metric-alarm \\
  --alarm-name <alarm-name> \\
  --alarm-actions arn:aws:sns:<region>:<account>:<topic>`,
  },
  NO_OK_ACTION: {
    title: "No OK action — recovery goes unnoticed",
    description: "Without an OK action, on-call never knows the issue cleared. Engineers keep investigating a problem that's already resolved.",
    fix:
`# Add to your existing put-metric-alarm call:
  --ok-actions arn:aws:sns:<region>:<account>:<topic>`,
  },
  INSUFFICIENT_DATA: {
    title: "Alarm stuck in INSUFFICIENT_DATA",
    description: "CloudWatch isn't receiving metric data. The resource may not have invoked recently, or metric publishing is broken. This alarm cannot fire in its current state.",
    fix:
`# Verify the metric is being emitted:
aws cloudwatch get-metric-statistics \\
  --namespace AWS/Lambda \\
  --metric-name Errors \\
  --dimensions Name=FunctionName,Value=<function> \\
  --start-time $(date -u -d '1 hour ago' +%FT%TZ) \\
  --end-time $(date -u +%FT%TZ) \\
  --period 300 --statistics Sum

# Or treat silence as breaching:
  --treat-missing-data breaching`,
  },
  MISSING_DATA_IGNORED: {
    title: "Missing data treated as not breaching",
    description: "Gaps in the metric are silently ignored. If the resource stops reporting (e.g. a dead function), the alarm stays green — giving a false sense of health.",
    fix:
`# Change TreatMissingData if silence = a problem:
  --treat-missing-data breaching`,
  },
  SINGLE_PERIOD_EVAL: {
    title: "Only 1 evaluation period — noisy alerts likely",
    description: "A single transient spike (Lambda retry, cold-start) will immediately trigger this alarm. Raising to 2–3 consecutive periods filters blips without delaying real alerts.",
    fix:
`# Require 2 consecutive breaching data points:
  --evaluation-periods 2 \\
  --datapoints-to-alarm 2

# With Period=60s this means 2 consecutive minutes
# of errors before the alarm fires.`,
  },
  STUCK_IN_ALARM: {
    title: "Alarm has been in ALARM state for an extended time",
    description: "A long-running ALARM often means the threshold is misconfigured, the underlying issue was fixed but the metric hasn't recovered, or nobody is actively responding to this alert.",
    fix:
`# Review recent metric data to understand why it hasn't recovered:
aws cloudwatch get-metric-statistics \\
  --namespace <namespace> \\
  --metric-name <metric> \\
  --start-time $(date -u -d '24 hours ago' +%FT%TZ) \\
  --end-time $(date -u +%FT%TZ) \\
  --period 300 --statistics Sum`,
  },
};

// ── IssueCard ─────────────────────────────────────────────────────────────────

function IssueCard({ issue }) {
  const [showFix, setShowFix] = useState(false);
  const meta  = ISSUE_META[issue.code] || { title: issue.message, description: null, fix: null };
  const color = ISSUE_COLOR[issue.severity] || "var(--muted)";

  // Badge colors per severity
  const badgeBg   = issue.severity === "critical" ? "rgba(220,38,38,0.1)"
                  : issue.severity === "warning"  ? "rgba(180,83,9,0.1)"
                  : "rgba(37,99,235,0.1)";
  const badgeBdr  = issue.severity === "critical" ? "rgba(220,38,38,0.3)"
                  : issue.severity === "warning"  ? "rgba(180,83,9,0.3)"
                  : "rgba(37,99,235,0.3)";

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 7,
      padding: "12px 13px",
      display: "grid",
      gridTemplateColumns: "10px 1fr auto",
      columnGap: 10,
      alignItems: "start",
    }}>
      {/* Severity dot */}
      <div style={{
        width: 8, height: 8, borderRadius: "50%",
        background: color,
        marginTop: 5, flexShrink: 0,
      }} />

      {/* Content */}
      <div>
        <div style={{
          fontSize: 13, fontWeight: 600, color: "var(--text)",
          marginBottom: meta.description ? 4 : 0,
          lineHeight: 1.4,
        }}>
          {meta.title}
        </div>
        {meta.description && (
          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 }}>
            {meta.description}
          </div>
        )}
        {meta.fix && (
          <>
            <button
              onClick={() => setShowFix(v => !v)}
              style={{
                marginTop: 8,
                background: "none", border: "none", padding: 0,
                fontFamily: "var(--font-mono)", fontSize: 11,
                color: "var(--blue)", cursor: "pointer",
              }}
            >
              {showFix ? "Hide fix ↑" : "Show fix ↓"}
            </button>
            {showFix && (
              <div style={{
                marginTop: 8,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 5,
                padding: "10px 12px",
              }}>
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: 9,
                  color: "var(--muted)", textTransform: "uppercase",
                  letterSpacing: 1, marginBottom: 6,
                }}>
                  Fix
                </div>
                <pre style={{
                  fontFamily: "var(--font-mono)", fontSize: 11,
                  color: "var(--blue)", lineHeight: 1.7,
                  whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0,
                }}>
                  {meta.fix}
                </pre>
              </div>
            )}
          </>
        )}
      </div>

      {/* Severity badge */}
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600,
        padding: "2px 8px", borderRadius: 99,
        background: badgeBg,
        border: `1px solid ${badgeBdr}`,
        color,
        whiteSpace: "nowrap",
        marginTop: 2,
      }}>
        {issue.severity}
      </span>
    </div>
  );
}

// ── AlarmAuditPanel ───────────────────────────────────────────────────────────

function AlarmAuditPanel({ data, loading, error, onClose, onRefresh }) {
  const [expanded, setExpanded] = useState(null);

  const summary = data?.summary;
  const alarms  = data?.alarms || [];

  const toggle = (name) => setExpanded(prev => prev === name ? null : name);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <div style={{
        padding: "13px 18px",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 8,
        flexShrink: 0, background: "var(--surface)",
      }}>
        <span style={{ color: "var(--yellow)", fontSize: 13 }}>⚙</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
          Alarm Configuration Audit
        </span>
        <button
          onClick={onRefresh}
          title="Re-fetch alarm configurations"
          style={{
            marginLeft: "auto", background: "none", border: "none",
            color: "var(--muted)", fontSize: 13, cursor: "pointer",
            fontFamily: "var(--font-mono)",
          }}
        >
          ↺
        </button>
        <button
          onClick={onClose}
          style={{
            background: "none", border: "none",
            color: "var(--muted)", fontSize: 18, cursor: "pointer", lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px 32px" }}>

        {loading && (
          <div style={{ textAlign: "center", paddingTop: 60 }}>
            <Spinner size={28} color="var(--yellow)" />
            <p style={{ color: "var(--muted)", marginTop: 20, fontSize: 13 }}>
              Fetching alarm configurations…
            </p>
          </div>
        )}

        {error && !loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <ErrorBanner error={error} />
            <button onClick={onRefresh} style={{ ...btnStyle, alignSelf: "flex-start" }}>
              ↺ Retry
            </button>
          </div>
        )}

        {data && !loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Summary chips */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                { label: "total",    value: summary.total,    color: "var(--text-dim)" },
                { label: "critical", value: summary.critical, color: "var(--red)"      },
                { label: "warning",  value: summary.warning,  color: "var(--yellow)"   },
                { label: "info",     value: summary.info,     color: "var(--blue)"     },
                { label: "ok",       value: summary.ok,       color: "var(--green)"    },
              ].filter(({ label, value }) => value > 0 || label === "total").map(({ label, value, color }) => (
                <div key={label} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "5px 12px",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 99,
                  fontFamily: "var(--font-mono)",
                }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color }}>{value}</span>
                  <span style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
                </div>
              ))}
            </div>

            {/* Alarm list */}
            {alarms.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", paddingTop: 24 }}>
                No alarms found matching the configured prefix.
              </p>
            ) : alarms.map((alarm) => (
              <AlarmCard
                key={alarm.name}
                alarm={alarm}
                isExpanded={expanded === alarm.name}
                onToggle={() => toggle(alarm.name)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── AlarmCard ─────────────────────────────────────────────────────────────────

function AlarmCard({ alarm, isExpanded, onToggle }) {
  const hColor = HEALTH_COLOR[alarm.health] || "var(--muted)";
  const hIcon  = HEALTH_ICON[alarm.health]  || "?";

  // Config rows: [label, value, isBad]
  const configRows = alarm.type === "metric" && alarm.metric ? [
    ["Namespace",    alarm.metric.namespace,           false],
    ["Metric",       alarm.metric.name,                false],
    ["Statistic",    alarm.metric.statistic,           false],
    ["Period",       alarm.metric.period_seconds != null ? `${alarm.metric.period_seconds}s` : null, false],
    ["Eval periods", alarm.metric.evaluation_periods,  alarm.metric.evaluation_periods === 1],
    ["DTP alarm",    alarm.metric.datapoints_to_alarm ?? "—", false],
    ["Threshold",    alarm.metric.threshold != null
                       ? `${alarm.metric.comparison_operator} ${alarm.metric.threshold}` : null, false],
    ["Missing data", alarm.metric.treat_missing_data,  alarm.metric.treat_missing_data === "missing"],
    ["Unit",         alarm.metric.unit || "—",         false],
    ...(alarm.metric.dimensions?.length > 0
        ? [["Dimensions", alarm.metric.dimensions.map(d => `${d.name}=${d.value}`).join(", "), false]]
        : []),
  ].filter(([, v]) => v != null && v !== "") : [];

  return (
    <div style={{
      border: "1px solid var(--border)",
      borderLeft: `3px solid ${hColor}`,
      borderRadius: "0 7px 7px 0",
      overflow: "hidden",
      background: "var(--bg)",
    }}>
      {/* Alarm row — always visible */}
      <div
        onClick={onToggle}
        style={{
          padding: "10px 14px",
          display: "flex", alignItems: "center", gap: 10,
          cursor: "pointer", userSelect: "none",
        }}
      >
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700,
          color: hColor, width: 14, textAlign: "center", flexShrink: 0,
        }}>
          {hIcon}
        </span>

        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)",
          flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {alarm.name}
        </span>

        {/* State pill */}
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 10,
          padding: "2px 7px", borderRadius: 4,
          background: alarm.state === "ALARM" ? "rgba(220,38,38,0.1)"
                    : alarm.state === "OK"    ? "rgba(5,150,105,0.1)"
                    : "rgba(107,114,128,0.1)",
          color: alarm.state === "ALARM" ? "var(--red)"
               : alarm.state === "OK"    ? "var(--green)"
               : "var(--muted)",
          border: `1px solid ${
            alarm.state === "ALARM" ? "rgba(220,38,38,0.3)"
          : alarm.state === "OK"    ? "rgba(5,150,105,0.25)"
          : "var(--border)"}`,
          flexShrink: 0,
        }}>
          {alarm.state}
        </span>

        {alarm.issues_count > 0 && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: hColor, flexShrink: 0 }}>
            {alarm.issues_count} issue{alarm.issues_count !== 1 ? "s" : ""}
          </span>
        )}

        <span style={{ color: "var(--muted)", fontSize: 10, flexShrink: 0 }}>
          {isExpanded ? "▲" : "▼"}
        </span>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div style={{ padding: "0 14px 16px", borderTop: "1px solid var(--border)" }}>

          {/* Issues — new card design */}
          {alarm.issues.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <AuditLabel>Issues &amp; fixes</AuditLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {alarm.issues.map((issue, i) => (
                  <IssueCard key={i} issue={issue} />
                ))}
              </div>
            </div>
          )}

          {/* Config grid */}
          {configRows.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <AuditLabel>Current configuration</AuditLabel>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 6,
              }}>
                {configRows.map(([k, v, isBad]) => (
                  <div key={k} style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 5,
                    padding: "8px 10px",
                  }}>
                    <div style={{
                      fontFamily: "var(--font-mono)", fontSize: 9,
                      color: "var(--muted)", textTransform: "uppercase",
                      letterSpacing: 0.8, marginBottom: 3,
                    }}>
                      {k}
                    </div>
                    <div style={{
                      fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
                      color: isBad ? "var(--yellow)" : "var(--text-dim)",
                      wordBreak: "break-all", lineHeight: 1.4,
                    }}>
                      {String(v)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Composite rule */}
          {alarm.type === "composite" && alarm.rule && (
            <div style={{ marginTop: 14 }}>
              <AuditLabel>Composite rule</AuditLabel>
              <div style={{
                fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)",
                background: "var(--surface)", padding: "8px 10px", borderRadius: 5,
                border: "1px solid var(--border)", wordBreak: "break-all", lineHeight: 1.6,
              }}>
                {alarm.rule}
              </div>
            </div>
          )}

          {/* Notification actions */}
          <div style={{ marginTop: 14 }}>
            <AuditLabel>Notification actions</AuditLabel>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 6,
            }}>
              {[
                ["ALARM", alarm.actions?.alarm],
                ["OK",    alarm.actions?.ok],
                ["INSUF", alarm.actions?.insufficient_data],
              ].map(([label, actions]) => {
                const hasActions = actions?.length > 0;
                return (
                  <div key={label} style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 5,
                    padding: "8px 10px",
                  }}>
                    <div style={{
                      fontFamily: "var(--font-mono)", fontSize: 9,
                      color: "var(--muted)", textTransform: "uppercase",
                      letterSpacing: 0.8, marginBottom: 3,
                    }}>
                      {label}
                    </div>
                    <div style={{
                      fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
                      color: hasActions ? "var(--text-dim)" : "var(--red)",
                      wordBreak: "break-all", lineHeight: 1.4,
                    }}>
                      {hasActions ? "configured" : "none"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Console link */}
          {alarm.url && (
            <div style={{ marginTop: 12 }}>
              <a
                href={alarm.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontFamily: "var(--font-mono)", fontSize: 10,
                  color: "var(--blue)", textDecoration: "none",
                }}
              >
                ↗ Open in AWS Console
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AuditLabel({ children }) {
  return (
    <div style={{
      fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--muted)",
      textTransform: "uppercase", letterSpacing: 1, marginBottom: 7,
    }}>
      {children}
    </div>
  );
}
