import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTimeline }     from "./hooks/useTimeline.js";
import { useSourceStatus } from "./hooks/useSourceStatus.js";
import { useAnalysis }     from "./hooks/useAnalysis.js";
import { useLocalStorage } from "./hooks/useLocalStorage.js";
import { TimelineEvent }   from "./components/TimelineEvent.jsx";
import { SourceFilter }    from "./components/SourceFilter.jsx";
import { EventDetail }     from "./components/EventDetail.jsx";
import { ErrorBanner }     from "./components/ErrorBanner.jsx";
import { Spinner }         from "./components/Spinner.jsx";
import { DensityBar }      from "./components/DensityBar.jsx";
import { SeverityDot }     from "./components/SeverityDot.jsx";
import { SOURCE_META }     from "./constants.js";
import { toInputValue }    from "./utils.js";
import { api }             from "./api.js";

// ── Time range presets ────────────────────────────────────────────────────────
const PRESETS = [
  { label: "1h",  ms: 1  * 60 * 60 * 1000 },
  { label: "4h",  ms: 4  * 60 * 60 * 1000 },
  { label: "24h", ms: 24 * 60 * 60 * 1000 },
  { label: "7d",  ms: 7  * 24 * 60 * 60 * 1000 },
  { label: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
];
function makeRange(ms) {
  const end = new Date(); const start = new Date(end - ms);
  return { start: start.toISOString(), end: end.toISOString() };
}
const DEFAULT_SOURCES = ["cloudwatch","github","grafana","pagerduty","datadog"];
const SEV_BG     = { critical:"rgba(226,75,74,0.09)",  warning:"rgba(186,117,23,0.09)", info:"rgba(55,138,221,0.09)",  success:"rgba(99,153,34,0.09)"  };
const SEV_BORDER = { critical:"rgba(226,75,74,0.28)",  warning:"rgba(186,117,23,0.28)", info:"rgba(55,138,221,0.28)",  success:"rgba(99,153,34,0.28)"  };
const SEV_HEX    = { critical:"#E24B4A",               warning:"#BA7517",               info:"#378ADD",                success:"#639922"               };
const CORR_COLORS = ["#8b5cf6","#0ea5e9","#10b981","#f59e0b","#ec4899","#6366f1"];

// ── Team colour palette (fallback while services.yml loads) ──────────────────
const TEAM_PALETTE = {
  backend:  { color:"#60a5fa", emoji:"⚡" },
  data:     { color:"#a78bfa", emoji:"◈"  },
  payments: { color:"#10b981", emoji:"💳" },
  infra:    { color:"#fb923c", emoji:"⬡"  },
  frontend: { color:"#f472b6", emoji:"⊞"  },
};

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const { events, loading, error, load } = useTimeline();
  const { sources, loading: sourcesLoading } = useSourceStatus();
  const { analysis, loading: analysisLoading, error: analysisError, run: runAnalysis, clear: clearAnalysis } = useAnalysis();

  // Persisted state
  const [theme,            setTheme]            = useLocalStorage("ob:theme",       "dark");
  const [activeSources,    setActiveSources]    = useLocalStorage("ob:sources",     DEFAULT_SOURCES);
  const [activePreset,     setActivePreset]     = useLocalStorage("ob:preset",      "4h");
  const [timeRange,        setTimeRange]        = useLocalStorage("ob:timeRange",   () => makeRange(4*60*60*1000));
  const [activeSeverities, setActiveSeverities] = useLocalStorage("ob:severities", ["critical","warning","info","success"]);
  const [activeTagFilters, setActiveTagFilters] = useLocalStorage("ob:tagFilters", []);

  // Ephemeral state — existing
  const [selectedEvent,  setSelectedEvent]  = useState(null);
  const [showAnalysis,   setShowAnalysis]   = useState(false);
  const [showAlarmAudit, setShowAlarmAudit] = useState(false);
  const [alarmAudit,     setAlarmAudit]     = useState(null);
  const [auditLoading,   setAuditLoading]   = useState(false);
  const [auditError,     setAuditError]     = useState(null);
  const [bannerError,    setBannerError]    = useState(null);
  const [searchQuery,    setSearchQuery]    = useState("");
  const [anchorEventId,  setAnchorEventId]  = useState(null);
  const [viewMode,       setViewMode]       = useState("list");
  const [copied,         setCopied]         = useState(false);
  const searchRef = useRef(null);

  // New state — v3 design
  const [activeTab,       setActiveTab]       = useState("service-map");
  const [liveCountdown,   setLiveCountdown]   = useState(30);
  const [deploySeconds,   setDeploySeconds]   = useState(252);
  const [svcStatusFilter, setSvcStatusFilter] = useState("all");
  const [svcRtFilter,     setSvcRtFilter]     = useState("all");
  const [svcTeamFilter,   setSvcTeamFilter]   = useState("all");
  const [svcMonFilter,    setSvcMonFilter]    = useState("all");
  const [svcViewMode,     setSvcViewMode]     = useState("grid");
  const [selectedService, setSelectedService] = useState(null);
  const [dpTab,           setDpTab]           = useState("metrics");
  const [showBrief,       setShowBrief]       = useState(false);
  const [svcSearch,       setSvcSearch]       = useState("");

  // Live service map data from API
  const [services,        setServices]        = useState([]);
  const [teams,           setTeams]           = useState([]);
  const [oncall,          setOncall]          = useState([]);
  const [activeIncidents, setActiveIncidents] = useState([]);
  const [svcLoading,      setSvcLoading]      = useState(false);

  // Sort + command palette
  const [svcSortMode,     setSvcSortMode]     = useState("status");  // "status"|"name"|"recent"
  const [showCmdPalette,  setShowCmdPalette]  = useState(false);
  const [cmdQuery,        setCmdQuery]        = useState("");

  // Morning Brief live data
  const [briefEvents,   setBriefEvents]   = useState([]);
  const [briefLoading,  setBriefLoading]  = useState(false);
  const [briefAnalysis, setBriefAnalysis] = useState(null);

  // Auto-discovery
  const [showDiscover,    setShowDiscover]    = useState(false);
  const [discoverData,    setDiscoverData]    = useState(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError,   setDiscoverError]   = useState(null);
  const [discoverSaving,  setDiscoverSaving]  = useState(false);
  const [discoverSaved,   setDiscoverSaved]   = useState(false);

  // URL state on mount
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.has("start") && p.has("end")) { setTimeRange({ start: p.get("start"), end: p.get("end") }); setActivePreset(null); }
    if (p.has("sources"))    setActiveSources(p.get("sources").split(",").filter(Boolean));
    if (p.has("severities")) setActiveSeverities(p.get("severities").split(",").filter(Boolean));
    if (p.has("tags"))       setActiveTagFilters(p.get("tags").split(",").filter(Boolean));
    if (p.has("view"))       setViewMode(p.get("view") === "lanes" ? "lanes" : "list");
  }, []); // eslint-disable-line

  // Keyboard shortcuts
  useEffect(() => {
    const h = (e) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault(); searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        if (showCmdPalette) { setShowCmdPalette(false); setCmdQuery(""); return; }
        if (showBrief) { setShowBrief(false); return; }
        if (selectedService) { setSelectedService(null); return; }
        if (document.activeElement === searchRef.current) { searchRef.current?.blur(); setSearchQuery(""); setSvcSearch(""); }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setShowCmdPalette(p => !p); setCmdQuery(""); return; }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [showBrief, selectedService]);

  // Theme
  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);
  const toggleTheme = useCallback(() => setTheme(t => t === "dark" ? "light" : "dark"), [setTheme]);

  // ── Service map data fetchers ────────────────────────────────────────────────
  const fetchServices = useCallback(async () => {
    setSvcLoading(true);
    try {
      const data = await api.getServices();
      setServices(data.services || []);
      setTeams(data.teams || []);
    } catch (e) {
      console.warn("Services fetch failed:", e.message);
    } finally {
      setSvcLoading(false);
    }
  }, []);

  const fetchOncall = useCallback(async () => {
    try {
      const data = await api.getOncall();
      if (data.configured) setOncall(data.oncall || []);
    } catch { /* silently ignore if PagerDuty not configured */ }
  }, []);

  const fetchActiveIncidents = useCallback(async () => {
    try {
      const data = await api.getActiveIncidents();
      if (data.configured) setActiveIncidents(data.incidents || []);
    } catch { /* silently ignore */ }
  }, []);

  // Morning Brief overnight fetch (today 01:00 → 09:00)
  useEffect(() => {
    if (!showBrief) return;
    const now = new Date();
    const start = new Date(now); start.setHours(1, 0, 0, 0);
    const end   = new Date(now); end.setHours(9, 0, 0, 0);
    // If before 9am local, use previous night's window
    if (now.getHours() < 9) { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); }
    setBriefLoading(true);
    api.getTimeline(start.toISOString(), end.toISOString(), DEFAULT_SOURCES)
      .then(data => {
        const evts = Array.isArray(data) ? data : (data.events ?? []);
        const sorted = [...evts].sort((a, b) => new Date(a.time) - new Date(b.time));
        setBriefEvents(sorted);
        setBriefLoading(false);
        if (sorted.length > 0) {
          api.analyze(sorted).then(r => setBriefAnalysis(r)).catch(() => {});
        }
      })
      .catch(() => setBriefLoading(false));
  }, [showBrief]); // eslint-disable-line

  // Initial load on mount
  useEffect(() => {
    fetchServices();
    fetchOncall();
    fetchActiveIncidents();
  }, []); // eslint-disable-line

  // Refresh services + incidents when live countdown ticks to 1
  useEffect(() => {
    if (liveCountdown === 1) {
      fetchServices();
      fetchActiveIncidents();
    }
  }, [liveCountdown]); // eslint-disable-line

  // Live countdown timer
  useEffect(() => {
    const t = setInterval(() => setLiveCountdown(c => c <= 1 ? 30 : c - 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Deploy watch timer
  useEffect(() => {
    const t = setInterval(() => setDeploySeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Load events
  useEffect(() => { setBannerError(null); }, [timeRange, activeSources]);
  useEffect(() => { load(timeRange.start, timeRange.end, activeSources); }, [timeRange, activeSources]); // eslint-disable-line
  useEffect(() => { if (error) setBannerError(error); }, [error]);

  // Auto-load data when switching to AI Summary / Config Audit tabs
  useEffect(() => {
    if (activeTab === "ai-summary" && !analysis && !analysisLoading && visibleEvents.length > 0) {
      runAnalysis(visibleEvents);
    }
    if (activeTab === "config-audit" && !alarmAudit && !auditLoading) {
      loadAudit();
    }
  }, [activeTab]); // eslint-disable-line

  // Handlers
  const handlePreset = useCallback((preset) => { setActivePreset(preset.label); setTimeRange(makeRange(preset.ms)); }, [setActivePreset, setTimeRange]);
  const handleCustomStart = useCallback((val) => { if (!val) return; setActivePreset(null); setTimeRange(r => ({ ...r, start: new Date(val).toISOString() })); }, [setActivePreset, setTimeRange]);
  const handleCustomEnd   = useCallback((val) => { if (!val) return; setActivePreset(null); setTimeRange(r => ({ ...r, end: new Date(val).toISOString() })); }, [setActivePreset, setTimeRange]);
  const handleSourceToggle = useCallback((src) => { setActiveSources(p => p.includes(src) ? p.filter(s => s !== src) : [...p, src]); }, [setActiveSources]);
  const handleSeverityToggle = useCallback((sev) => { setActiveSeverities(p => p.includes(sev) ? p.filter(s => s !== sev) : [...p, sev]); }, [setActiveSeverities]);
  const handleDensityZoom = useCallback((start, end) => { setActivePreset(null); setTimeRange({ start, end }); }, [setActivePreset, setTimeRange]);
  const handleTagClick = useCallback((tag) => { setActiveTagFilters(p => p.includes(tag) ? p.filter(t => t !== tag) : [...p, tag]); }, [setActiveTagFilters]);
  const handleSetAnchor = useCallback((id) => { setAnchorEventId(p => p === id ? null : id); }, []);

  const handleAnalyze = useCallback(() => {
    setShowAnalysis(true); setSelectedEvent(null); runAnalysis(visibleEvents);
  }, [events, activeSources]); // eslint-disable-line

  const loadAudit = useCallback(async () => {
    if (alarmAudit) return;
    setAuditLoading(true); setAuditError(null);
    try { const data = await api.auditAll(); setAlarmAudit(data); }
    catch (e) { setAuditError(e.message || "Alarm audit failed"); }
    finally { setAuditLoading(false); }
  }, [alarmAudit]);

  const handleAlarmAudit = useCallback(async () => {
    setShowAlarmAudit(true); setShowAnalysis(false); setSelectedEvent(null);
    setAuditError(null);
    if (alarmAudit) return;
    setAuditLoading(true);
    try { const data = await api.auditAll(); setAlarmAudit(data); }
    catch (e) { setAuditError(e.message || "Alarm audit failed"); }
    finally { setAuditLoading(false); }
  }, [alarmAudit]);

  const handleAlarmAuditRefresh = useCallback(async () => {
    setAlarmAudit(null); setAuditError(null); setAuditLoading(true);
    try { const data = await api.auditAll(); setAlarmAudit(data); }
    catch (e) { setAuditError(e.message || "Alarm audit failed"); }
    finally { setAuditLoading(false); }
  }, []);

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(visibleEvents, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `fusenix-${new Date().toISOString().slice(0,16)}.json`;
    a.click(); URL.revokeObjectURL(url);
  }, [events, activeSources]); // eslint-disable-line

  const handleCopyLink = useCallback(() => {
    const p = new URLSearchParams();
    p.set("start", timeRange.start); p.set("end", timeRange.end);
    p.set("sources", activeSources.join(",")); p.set("severities", activeSeverities.join(","));
    if (activeTagFilters.length > 0) p.set("tags", activeTagFilters.join(","));
    if (viewMode === "lanes") p.set("view", "lanes");
    if (selectedEvent) p.set("event", selectedEvent.id);
    const url = `${window.location.origin}${window.location.pathname}?${p.toString()}`;
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {
      const inp = document.createElement("input"); inp.value = url;
      document.body.appendChild(inp); inp.select(); document.execCommand("copy"); document.body.removeChild(inp);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  }, [timeRange, activeSources, activeSeverities, activeTagFilters, viewMode, selectedEvent]);

  // Derived
  const sourceFilteredEvents = useMemo(() => {
    let evs = events.filter(e => activeSources.includes(e.source));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      evs = evs.filter(e => e.title?.toLowerCase().includes(q) || e.detail?.toLowerCase().includes(q) || e.source?.toLowerCase().includes(q) || e.tags?.some(t => t.toLowerCase().includes(q)));
    }
    return evs;
  }, [events, activeSources, searchQuery]);

  const visibleEvents = useMemo(() => {
    let evs = sourceFilteredEvents.filter(e => activeSeverities.includes(e.severity));
    if (activeTagFilters.length > 0) evs = evs.filter(e => activeTagFilters.some(tag => e.tags?.includes(tag)));
    return evs;
  }, [sourceFilteredEvents, activeSeverities, activeTagFilters]);

  const stats = useMemo(() => {
    const c = { critical:0, warning:0, info:0, success:0 };
    for (const e of sourceFilteredEvents) c[e.severity] = (c[e.severity]||0)+1;
    return c;
  }, [sourceFilteredEvents]);

  const correlationMap = useMemo(() => {
    const WIN_MS = 2*60*1000;
    const SOURCE_TAGS = new Set(["cloudwatch","grafana","datadog","pagerduty","github","cicd","deployment","commit","pull_request","workflow_run","alarm_history"]);
    const sorted = [...visibleEvents].sort((a,b) => new Date(a.time)-new Date(b.time));
    const parent = new Map();
    const find = (id) => { if (!parent.has(id)) parent.set(id,id); if (parent.get(id)!==id) parent.set(id,find(parent.get(id))); return parent.get(id); };
    const union = (a,b) => parent.set(find(a),find(b));
    for (let i=0;i<sorted.length;i++) {
      const ea=sorted[i]; const ta=new Date(ea.time).getTime();
      for (let j=i+1;j<sorted.length;j++) {
        const eb=sorted[j]; const tb=new Date(eb.time).getTime();
        if (tb-ta>WIN_MS) break;
        const tagsA=(ea.tags??[]).filter(t=>!SOURCE_TAGS.has(t));
        const tagsB=(eb.tags??[]).filter(t=>!SOURCE_TAGS.has(t));
        if (tagsA.some(t=>tagsB.includes(t))) union(ea.id,eb.id);
      }
    }
    const groupIds=new Map(); const result=new Map(); let counter=0;
    for (const ev of sorted) {
      const root=find(ev.id);
      if (!groupIds.has(root)) { const members=sorted.filter(e=>find(e.id)===root); if (members.length>1) groupIds.set(root,counter++); }
      if (groupIds.has(root)) { const gid=groupIds.get(root); result.set(ev.id,{ groupId:gid, color:CORR_COLORS[gid%CORR_COLORS.length] }); }
    }
    return result;
  }, [visibleEvents]);

  const anchorTime = useMemo(() => {
    if (!anchorEventId) return null;
    const ev = visibleEvents.find(e => e.id === anchorEventId);
    return ev ? new Date(ev.time).getTime() : null;
  }, [anchorEventId, visibleEvents]);

  const getGroupFlags = useCallback((eventId, index, list) => {
    const info = correlationMap.get(eventId);
    if (!info) return { isInGroup: false };
    const gid = info.groupId; const color = info.color;
    const prevSame = index > 0 && correlationMap.get(list[index-1]?.id)?.groupId === gid;
    const nextSame = index < list.length-1 && correlationMap.get(list[index+1]?.id)?.groupId === gid;
    return { isInGroup:true, correlationGroupId:gid, correlationColor:color, isFirstInGroup:!prevSame, isLastInGroup:!nextSame };
  }, [correlationMap]);

  // Filtered services for service map (live data from API)
  const visibleServices = useMemo(() => {
    const STATUS_ORDER = { critical: 0, warning: 1, ok: 2, unknown: 3 };
    const filtered = services.filter(s => {
      if (svcStatusFilter !== "all" && s.status !== svcStatusFilter) return false;
      if (svcRtFilter !== "all" && s.runtime !== svcRtFilter) return false;
      if (svcTeamFilter !== "all" && s.team !== svcTeamFilter) return false;
      if (svcMonFilter !== "all" && !s.sources?.find(src => src.name === svcMonFilter)) return false;
      if (svcSearch && !s.name.toLowerCase().includes(svcSearch.toLowerCase())) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (svcSortMode === "name")   return a.name.localeCompare(b.name);
      if (svcSortMode === "recent") {
        const ta = a.lastEvtRaw ? new Date(a.lastEvtRaw).getTime() : 0;
        const tb = b.lastEvtRaw ? new Date(b.lastEvtRaw).getTime() : 0;
        return tb - ta;
      }
      // default "status": critical → warning → ok
      return (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3);
    });
  }, [services, svcStatusFilter, svcRtFilter, svcTeamFilter, svcMonFilter, svcSearch, svcSortMode]);

  const svcCounts = useMemo(() => ({
    all:      services.length,
    critical: services.filter(s=>s.status==="critical").length,
    warning:  services.filter(s=>s.status==="warning").length,
    ok:       services.filter(s=>s.status==="ok").length,
  }), [services]);

  const deployMin = String(Math.floor(deploySeconds/60)).padStart(2,"0");
  const deploySec = String(deploySeconds%60).padStart(2,"0");
  const hasIncidentPanel = selectedEvent || showAnalysis || showAlarmAudit;
  const isDark = theme === "dark";
  const criticalIncidents = services.filter(s=>s.status==="critical").length;

  // Tab switcher
  const handleTabSwitch = (tab) => {
    setActiveTab(tab);
    if (tab === "ai-summary") { setShowAnalysis(true); setShowAlarmAudit(false); setSelectedEvent(null); }
    if (tab === "config-audit") { setShowAlarmAudit(true); setShowAnalysis(false); setSelectedEvent(null); if (!alarmAudit && !auditLoading) handleAlarmAudit(); }
    if (tab === "incidents") { setShowAnalysis(false); setShowAlarmAudit(false); }
    if (tab === "service-map") { setShowAnalysis(false); setShowAlarmAudit(false); }
  };

  return (
    <div style={{ height:"100vh", display:"flex", flexDirection:"column", background:"var(--bg)", color:"var(--text)", fontFamily:"var(--font-sans)", overflow:"hidden", fontSize:13 }}>

      {/* ── Header ── */}
      <header style={{ height:48, flexShrink:0, background:"var(--surface)", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", padding:"0 14px", gap:10 }}>
        <div style={{ fontSize:15, fontWeight:700, letterSpacing:-0.5, whiteSpace:"nowrap", userSelect:"none", cursor:"pointer" }}>
          Fuse<span style={{ color:"var(--blue)" }}>nix</span>
        </div>
        {services.length > 0 && (
          <span style={{ fontSize:10, fontFamily:"var(--font-mono)", background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:4, padding:"2px 8px", color:"var(--muted)", whiteSpace:"nowrap" }}>
            {[...new Set(services.map(s=>s.env))].filter(Boolean).join(" · ") || "production"}
          </span>
        )}
        <div className="h-divider" />
        <div className="header-search-wrap">
          <span className="header-search-icon">⌕</span>
          <input
            ref={searchRef}
            className="header-search-input"
            type="text"
            placeholder={activeTab === "service-map" ? "Search services, tags, owners…" : "Search events — title, detail, source, tag…"}
            value={activeTab === "service-map" ? svcSearch : searchQuery}
            onChange={e => activeTab === "service-map" ? setSvcSearch(e.target.value) : setSearchQuery(e.target.value)}
          />
          {!(activeTab === "service-map" ? svcSearch : searchQuery) && (
            <span className="header-search-kbd">/</span>
          )}
        </div>
        <div className="live-badge">
          <div className="live-dot" />
          <span className="live-lbl">LIVE</span>
          <span className="live-count-txt">{liveCountdown}s</span>
        </div>
        <div style={{ display:"flex", gap:5, alignItems:"center", flexShrink:0 }}>
          <button className="hbtn hbtn-cmd" onClick={()=>{setShowCmdPalette(p=>!p);setCmdQuery("");}}>⌘K</button>
          <button className="hbtn" onClick={handleExport} disabled={visibleEvents.length===0} style={{ opacity: visibleEvents.length===0 ? 0.4 : 1 }}>↓ Export</button>
          <button className="hbtn" onClick={handleCopyLink} style={{ color: copied ? "var(--green)" : undefined, borderColor: copied ? "rgba(5,150,105,0.4)" : undefined }}>
            {copied ? "✓ Copied!" : "⎘ Share"}
          </button>
          <button className="hbtn" onClick={() => load(timeRange.start, timeRange.end, activeSources)} disabled={loading}>
            {loading ? <Spinner size={11} color="var(--muted)" /> : "↺"}{!loading && " Refresh"}
          </button>
          <div className="h-divider" />
          <label className="theme-toggle" title={isDark ? "Light mode" : "Dark mode"}>
            <span className="theme-toggle-icon">☀</span>
            <input type="checkbox" checked={isDark} onChange={toggleTheme} />
            <span className="theme-toggle-track"><span className="theme-toggle-thumb" /></span>
            <span className="theme-toggle-icon">☾</span>
          </label>
        </div>
      </header>

      {/* ── Sub-nav ── */}
      <div className="subnav">
        <button className={`subnav-item${activeTab==="service-map"?" active":""}`} onClick={()=>handleTabSwitch("service-map")}>⬡ Service Map</button>
        <button className={`subnav-item${activeTab==="incidents"?" active":""}`} onClick={()=>handleTabSwitch("incidents")}>
          ≡ Incidents {criticalIncidents > 0 && <span className="nav-badge">{criticalIncidents}</span>}
        </button>
        <button className={`subnav-item${activeTab==="ai-summary"?" active":""}`} onClick={()=>handleTabSwitch("ai-summary")}>◈ AI Summary</button>
        <button className={`subnav-item${activeTab==="config-audit"?" active":""}`} onClick={()=>handleTabSwitch("config-audit")}>⚙ Config Audit</button>
        <div className="subnav-sep" />
        <div className="subnav-summary">
          <span className="sum-stat"><span className="sum-dot" style={{background:"var(--red)"}} /> <span>{svcCounts.critical}</span> critical</span>
          <span className="sum-stat"><span className="sum-dot" style={{background:"var(--yellow)"}} /> <span>{svcCounts.warning}</span> warning</span>
          <span className="sum-stat"><span className="sum-dot" style={{background:"var(--green)"}} /> <span>{svcCounts.ok}</span> healthy</span>
        </div>
      </div>

      {/* ── Error banner ── */}
      {bannerError && (
        <div style={{ padding:"8px 20px", flexShrink:0 }}>
          <ErrorBanner error={bannerError} onDismiss={()=>setBannerError(null)} onRetry={()=>load(timeRange.start,timeRange.end,activeSources)} />
        </div>
      )}

      {/* ── Body ── */}
      <div style={{ flex:1, display:"flex", overflow:"hidden", minHeight:0 }}>

        {/* Sidebar — shown for service-map and incidents */}
        {(activeTab==="service-map"||activeTab==="incidents") && (
          <aside style={{ width:196, flexShrink:0, background:"var(--surface)", borderRight:"1px solid var(--border)", display:"flex", flexDirection:"column", overflowY:"auto", overflowX:"hidden" }}>
            {activeTab==="service-map" ? (
              // Service Map sidebar
              <>
                <div className="sb-section">
                  <div className="sb-label">Status</div>
                  <div className="filter-group">
                    {[["all","All services","var(--border-hi)"],["critical","Critical","var(--red)"],["warning","Warning","var(--yellow)"],["ok","Healthy","var(--green)"]].map(([val,label,color])=>(
                      <button key={val} className={`filter-item${svcStatusFilter===val?" active":""}`} onClick={()=>setSvcStatusFilter(val)}>
                        <span className="filter-dot" style={{background:color}} /> {label}
                        <span className="filter-count">{svcCounts[val]??svcCounts.all}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="sb-section">
                  <div className="sb-label">Runtime</div>
                  <div className="runtime-filter">
                    {["all","EKS","EC2","Lambda","RDS","ECS"].map(rt=>(
                      <button key={rt} className={`rt-chip${svcRtFilter===rt?" on":""}`} onClick={()=>setSvcRtFilter(rt)}>{rt==="all"?"All":rt}</button>
                    ))}
                  </div>
                </div>
                <div className="sb-section">
                  <div className="sb-label">Team</div>
                  <div style={{display:"flex",flexDirection:"column",gap:2}}>
                    <button className={`team-item${svcTeamFilter==="all"?" active":""}`} onClick={()=>setSvcTeamFilter("all")}>
                      <div className="team-avatar" style={{background:"var(--surface2)",color:"var(--muted)"}}>★</div> All teams
                    </button>
                    {teams.map(t=>(
                      <button key={t.id} className={`team-item${svcTeamFilter===t.id?" active":""}`} onClick={()=>setSvcTeamFilter(t.id)}>
                        <div className="team-avatar" style={{background:t.color+"22",color:t.color}}>{t.emoji}</div> {t.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="sb-section">
                  <div className="sb-label">Monitoring</div>
                  <div className="filter-group">
                    {[["all","All sources","◉",""],["PagerDuty","PagerDuty","⬡","#10b981"],["CloudWatch","CloudWatch","☁","#fb923c"],["Datadog","Datadog","◈","#a78bfa"],["Grafana","Grafana","▣","#f87171"]].map(([val,label,icon,color])=>(
                      <button key={val} className={`filter-item${svcMonFilter===val?" active":""}`} onClick={()=>setSvcMonFilter(val)}>
                        <span style={{fontSize:11,color:color||undefined}}>{icon}</span> {label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              // Incidents sidebar
              <div style={{display:"flex",flexDirection:"column",gap:20,padding:"14px 12px"}}>
                {/* Time range */}
                <div>
                  <div style={sidebarLabelStyle}>Time range</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:8}}>
                    {PRESETS.map(p=>(
                      <button key={p.label} onClick={()=>handlePreset(p)} style={{ padding:"3px 10px",borderRadius:4,fontSize:11,fontFamily:"var(--font-mono)",fontWeight:600, background:activePreset===p.label?"var(--blue)":"var(--surface2)", border:activePreset===p.label?"1px solid var(--blue)":"1px solid var(--border)", color:activePreset===p.label?"#fff":"var(--muted)", cursor:"pointer" }}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    <input type="datetime-local" value={toInputValue(timeRange.start)} onChange={e=>handleCustomStart(e.target.value)} style={inputStyle} />
                    <input type="datetime-local" value={toInputValue(timeRange.end)}   onChange={e=>handleCustomEnd(e.target.value)}   style={inputStyle} />
                  </div>
                </div>
                {/* Sources */}
                <div>
                  <div style={sidebarLabelStyle}>Sources</div>
                  {Object.entries(SOURCE_META).map(([key,m])=>{
                    const active = activeSources.includes(key);
                    const count  = events.filter(e=>e.source===key).length;
                    const configured = sources[key]?.configured;
                    return (
                      <div key={key} onClick={()=>handleSourceToggle(key)} title={configured===false?`${m.label} not configured`:active?`Hide ${m.label}`:`Show ${m.label}`}
                        style={{ display:"flex",alignItems:"center",gap:7,padding:"5px 6px",borderRadius:5,cursor:"pointer",marginBottom:2, opacity:configured===false?0.4:1, background:active?m.color+"12":"transparent",transition:"background 0.1s" }}
                        onMouseEnter={e=>{if(!active)e.currentTarget.style.background="var(--surface2)"}}
                        onMouseLeave={e=>{if(!active)e.currentTarget.style.background=active?m.color+"12":"transparent"}}>
                        <span style={{width:6,height:6,borderRadius:"50%",flexShrink:0,background:configured===true?"var(--green)":configured===false?"var(--red)":"var(--border-hi)"}} />
                        <span style={{width:8,height:8,borderRadius:"50%",background:m.color,flexShrink:0}} />
                        <span style={{flex:1,fontSize:12,color:active?"var(--text)":"var(--text-dim)"}}>{m.label}</span>
                        {count>0&&<span style={{fontSize:10,background:"var(--surface2)",borderRadius:10,padding:"1px 6px",color:"var(--muted)",fontFamily:"var(--font-mono)"}}>{count}</span>}
                        {configured===false&&<span style={{fontSize:9,color:"var(--red)",opacity:0.7}}>✕</span>}
                      </div>
                    );
                  })}
                </div>
                {/* Severity */}
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={sidebarLabelStyle}>Severity</div>
                    <button onClick={()=>setActiveSeverities(["critical","warning","info","success"])} style={{background:"none",border:"none",fontSize:10,cursor:"pointer",padding:0,color:activeSeverities.length<4?"var(--blue)":"var(--border-hi)"}}>reset</button>
                  </div>
                  {[{key:"critical",label:"Critical"},{key:"warning",label:"Warning"},{key:"info",label:"Info"},{key:"success",label:"Success"}].map(({key,label})=>{
                    const active=activeSeverities.includes(key); const count=stats[key]||0;
                    return (
                      <div key={key} onClick={()=>handleSeverityToggle(key)}
                        style={{display:"flex",alignItems:"center",gap:8,padding:"5px 6px",borderRadius:5,cursor:"pointer",marginBottom:2,background:active?SEV_BG[key]:"transparent",border:active?`1px solid ${SEV_BORDER[key]}`:"1px solid transparent",opacity:active?1:0.42,transition:"opacity 0.15s,background 0.1s"}}
                        onMouseEnter={e=>{if(!active)e.currentTarget.style.opacity="0.7"}}
                        onMouseLeave={e=>{if(!active)e.currentTarget.style.opacity="0.42"}}>
                        <div style={{width:14,height:14,borderRadius:3,flexShrink:0,border:active?`1.5px solid ${SEV_HEX[key]}`:"1.5px solid var(--border-hi)",background:active?SEV_HEX[key]:"transparent",display:"flex",alignItems:"center",justifyContent:"center",transition:"background 0.12s"}}>
                          {active&&<svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="white" strokeWidth="1.5"><polyline points="1,4 3,6 7,2" /></svg>}
                        </div>
                        <SeverityDot severity={key} size={10} />
                        <span style={{flex:1,fontSize:12,color:active?"var(--text)":"var(--text-dim)"}}>{label}</span>
                        {count>0&&<span style={{fontSize:10,background:"var(--surface2)",borderRadius:10,padding:"1px 6px",color:"var(--muted)",fontFamily:"var(--font-mono)"}}>{count}</span>}
                      </div>
                    );
                  })}
                </div>
                {anchorEventId&&(
                  <div style={{background:"rgba(220,38,38,0.07)",border:"1px solid rgba(220,38,38,0.25)",borderRadius:6,padding:"8px 10px"}}>
                    <div style={{fontFamily:"var(--font-mono)",fontSize:9,color:"var(--red)",textTransform:"uppercase",letterSpacing:0.8,marginBottom:4}}>T=0 anchor set</div>
                    <div style={{fontSize:11,color:"var(--text-dim)",lineHeight:1.5}}>All timestamps show relative deltas.</div>
                    <button onClick={()=>setAnchorEventId(null)} style={{marginTop:6,background:"none",border:"none",padding:0,fontFamily:"var(--font-mono)",fontSize:10,color:"var(--red)",cursor:"pointer"}}>✕ Clear anchor</button>
                  </div>
                )}
              </div>
            )}
          </aside>
        )}

        {/* ── Main content ── */}
        <div style={{ flex:1, display:"flex", overflow:"hidden", minWidth:0 }}>

          {/* Service Map */}
          {activeTab==="service-map" && (
            <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
              {/* Active incident bar — shown only when there are real active incidents */}
              {(()=>{
                // Sources: PagerDuty active incidents OR any critical/warning service from any monitoring source
                const pdInc = activeIncidents[0];
                const critSvc = services.find(s=>s.status==="critical") || services.find(s=>s.status==="warning");
                const hasActive = pdInc || critSvc;
                if (!hasActive) return null;
                const svcTarget = pdInc
                  ? services.find(s=>s.pagerduty_id===pdInc.service_id || s.name===pdInc.service_name) || critSvc
                  : critSvc;
                const incTitle = pdInc
                  ? `${pdInc.title || "Active incident"} — ${pdInc.service_name || svcTarget?.name || "unknown"}`
                  : `${critSvc.alertCount > 0 ? critSvc.alertCount+" alert"+(critSvc.alertCount>1?"s":"")+" · " : ""}${critSvc.name} is ${critSvc.status}`;
                const affectedCount = services.filter(s=>s.status==="critical"||s.status==="warning").length;
                return (
                  <div className="incident-bar">
                    <div className="ib-pulse" />
                    <span className="ib-text">{incTitle}{affectedCount>1?` · ${affectedCount} services affected`:""}</span>
                    {svcTarget && <button className="ib-link" onClick={()=>{setSelectedService(svcTarget);setDpTab("events");}}>→ Open Incident View</button>}
                  </div>
                );
              })()}
              {/* Deploy watch bar — most relevant deploy (prefer critical/warning services with recent deploy) */}
              {(()=>{
                const withDeploy = services.filter(s=>s.deploy?.last_deploy_ref);
                if (withDeploy.length === 0) return null;
                const deploySvc = withDeploy.find(s=>s.status==="critical") || withDeploy.find(s=>s.status==="warning") || withDeploy[0];
                const d = deploySvc.deploy;
                return (
                  <div className="deploy-bar">
                    <span style={{fontSize:12,flexShrink:0}}>◈</span>
                    <span className="deploy-bar-text">
                      Deploy detected: <b>{deploySvc.name}/{d.last_deploy_ref}</b> → {d.last_deploy_env||"production"}
                      {d.last_deploy_ago ? ` · ${d.last_deploy_ago}` : ""} · Deploy Watch active
                    </span>
                    <span className="deploy-timer">watching {deployMin}:{deploySec}</span>
                    <button className="deploy-watch-btn" onClick={()=>{setSelectedService(deploySvc);setDpTab("deploy");}}>⧉ View comparison</button>
                  </div>
                );
              })()}
              {/* Toolbar */}
              <div className="grid-toolbar">
                <span className="group-label">Grouped by environment</span>
                <div style={{flex:1}} />
                <button className="morning-brief-btn" onClick={()=>setShowBrief(true)}>☀ Morning Brief</button>
                <button className="morning-brief-btn" style={{background:"var(--surface2)",border:"1px solid var(--border-hi)"}} onClick={()=>{setShowDiscover(true);if(!discoverData&&!discoverLoading){setDiscoverLoading(true);setDiscoverError(null);api.discoverServices().then(d=>{setDiscoverData(d);setDiscoverLoading(false);}).catch(e=>{setDiscoverError(e.message);setDiscoverLoading(false);});}}}>⬡ Auto-discover</button>
                <div className="view-btns">
                  <button className={`view-btn${svcViewMode==="grid"?" on":""}`} onClick={()=>setSvcViewMode("grid")}>⊞ Grid</button>
                  <button className={`view-btn${svcViewMode==="list"?" on":""}`} onClick={()=>setSvcViewMode("list")}>≡ List</button>
                </div>
                <button className="sort-btn" title="Cycle sort order" onClick={()=>setSvcSortMode(m=>m==="status"?"name":m==="name"?"recent":"status")}>
                  {svcSortMode==="status"?"↕ Status":svcSortMode==="name"?"↕ Name":"↕ Recent"}
                </button>
              </div>
              {/* Service grid */}
              {svcLoading && services.length === 0 && (
                <div style={{display:"flex",alignItems:"center",gap:8,padding:"24px 0",color:"var(--muted)",fontFamily:"var(--font-mono)",fontSize:12}}>
                  <span style={{animation:"spin 1s linear infinite",display:"inline-block"}}>⟳</span>
                  Loading services from CloudWatch, Grafana &amp; PagerDuty…
                </div>
              )}
              <div id="service-grid-area">
                {visibleServices.length===0 ? (
                  <div style={{padding:40,textAlign:"center",color:"var(--muted)",fontFamily:"var(--font-mono)",fontSize:12}}>No services match</div>
                ) : (
                  (() => {
                    const envOrder=["production","staging","dev"];
                    const envs=[...new Set(visibleServices.map(s=>s.env))].sort((a,b)=>envOrder.indexOf(a)-envOrder.indexOf(b));
                    return envs.map(env=>{
                      const group=visibleServices.filter(s=>s.env===env);
                      const hasCrit=group.some(s=>s.status==="critical");
                      const hasWarn=group.some(s=>s.status==="warning");
                      const hc=hasCrit?"var(--red)":hasWarn?"var(--yellow)":"var(--green)";
                      const hl=hasCrit||hasWarn?"● DEGRADED":"● HEALTHY";
                      return (
                        <div key={env} className="env-group">
                          <div className="env-hdr">
                            <span className="env-name">{env}</span>
                            <span className="env-count">{group.length}</span>
                            <span className="env-health" style={{color:hc}}>{hl}</span>
                          </div>
                          <div className={`svc-grid${svcViewMode==="list"?" list":""}`}>
                            {group.map(svc=>(
                              <ServiceCard key={svc.id} svc={svc} onClick={()=>{setSelectedService(svc);setDpTab("metrics");}} />
                            ))}
                          </div>
                        </div>
                      );
                    });
                  })()
                )}
              </div>
              {/* Correlation bar — shown when 2+ services are critical/warning (likely correlated) */}
              {(()=>{
                const affected = services.filter(s=>s.status==="critical"||s.status==="warning");
                if (affected.length < 2) return null;
                return (
                  <div className="correlation-bar">
                    <span style={{fontSize:13,flexShrink:0}}>⚡</span>
                    <span className="corr-text">Correlated activity — <b>{affected.length} services</b> degraded in the same window:</span>
                    <div className="corr-chips">
                      {affected.slice(0,5).map(s=>(
                        <button key={s.id} className="corr-chip" onClick={()=>{setSelectedService(s);setDpTab("events");}}>{s.name}</button>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Incidents tab — timeline + optional right panel */}
          {activeTab==="incidents" && (
            <>
              <section style={{flex:1,display:"flex",flexDirection:"column",background:"var(--surface)",borderRight:"1px solid var(--border)",overflow:"hidden",minWidth:0}}>
                <DensityBar events={events.filter(e=>activeSources.includes(e.source))} timeRange={timeRange} onZoom={handleDensityZoom} />
                {/* Toolbar */}
                <div style={{padding:"7px 16px",borderBottom:"1px solid var(--border)",background:"var(--surface)",flexShrink:0,display:"flex",gap:8,alignItems:"center"}}>
                  <div style={{position:"relative",flex:1}}>
                    <input ref={searchRef} type="text" placeholder="Search events…" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}
                      style={{width:"100%",padding:"5px 36px 5px 10px",fontSize:12,borderRadius:5,border:"1px solid var(--border-hi)",background:"var(--bg)",color:"var(--text)",fontFamily:"var(--font-sans)",outline:"none"}} />
                    {!searchQuery&&<span style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"var(--surface2)",border:"1px solid var(--border-hi)",borderRadius:4,padding:"1px 5px",fontSize:10,color:"var(--muted)",fontFamily:"var(--font-mono)",pointerEvents:"none"}}>/</span>}
                  </div>
                  <div style={{display:"flex",gap:0,flexShrink:0,border:"1px solid var(--border-hi)",borderRadius:5,overflow:"hidden"}}>
                    {[{mode:"list",icon:"☰"},{mode:"lanes",icon:"⊟"}].map(({mode,icon})=>(
                      <button key={mode} onClick={()=>setViewMode(mode)} style={{padding:"4px 9px",border:"none",background:viewMode===mode?"var(--blue)":"transparent",color:viewMode===mode?"#fff":"var(--muted)",fontSize:12,cursor:"pointer",transition:"background 0.1s"}}>{icon}</button>
                    ))}
                  </div>
                  <button onClick={handleAnalyze} disabled={visibleEvents.length===0||analysisLoading}
                    style={{...btnStyle,background:showAnalysis?"rgba(5,150,105,0.1)":"transparent",border:`1px solid ${showAnalysis?"rgba(5,150,105,0.35)":"var(--border-hi)"}`,color:showAnalysis?"var(--green)":"var(--muted)",opacity:visibleEvents.length===0?0.4:1}}>
                    {analysisLoading?<Spinner size={11} color="var(--green)"/>:<span>◈</span>}
                    {analysisLoading?"Analyzing…":"AI Analysis"}
                  </button>
                  <button onClick={handleAlarmAudit}
                    style={{...btnStyle,background:showAlarmAudit?"rgba(234,179,8,0.1)":"transparent",border:`1px solid ${showAlarmAudit?"rgba(234,179,8,0.4)":"var(--border-hi)"}`,color:showAlarmAudit?"var(--yellow)":"var(--muted)"}}>
                    {auditLoading?<Spinner size={11} color="var(--yellow)"/>:<span>⚙</span>}
                    {auditLoading?"Auditing…":"Config Audit"}
                  </button>
                </div>
                {/* Tag filters */}
                {activeTagFilters.length>0&&(
                  <div style={{padding:"5px 16px",borderBottom:"1px solid var(--border)",background:"var(--bg)",display:"flex",gap:5,flexWrap:"wrap",alignItems:"center",flexShrink:0}}>
                    <span style={{fontSize:10,color:"var(--muted)",fontFamily:"var(--font-mono)",flexShrink:0}}>tag:</span>
                    {activeTagFilters.map(tag=>(
                      <span key={tag} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 7px",borderRadius:4,fontSize:10,fontFamily:"var(--font-mono)",background:"var(--blue)",color:"#fff",userSelect:"none"}}>
                        #{tag}<button onClick={()=>handleTagClick(tag)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.8)",fontSize:11,cursor:"pointer",padding:0,lineHeight:1}}>×</button>
                      </span>
                    ))}
                    <button onClick={()=>setActiveTagFilters([])} style={{background:"none",border:"none",fontSize:10,cursor:"pointer",padding:0,color:"var(--muted)",fontFamily:"var(--font-mono)",marginLeft:2}}>clear all</button>
                  </div>
                )}
                {/* Event list */}
                <div style={{flex:1,overflowY:"auto"}}>
                  {loading&&visibleEvents.length===0?<EmptyState loading />
                  :!loading&&visibleEvents.length===0&&!error?<EmptyState />
                  :viewMode==="lanes"?(
                    <LanesView visibleEvents={visibleEvents} activeSources={activeSources} selectedEvent={selectedEvent} correlationMap={correlationMap} anchorEventId={anchorEventId} anchorTime={anchorTime} onTagClick={handleTagClick} activeTagFilters={activeTagFilters} onSetAnchor={handleSetAnchor}
                      onSelect={ev=>{setSelectedEvent(ev);setShowAnalysis(false);setShowAlarmAudit(false);}} />
                  ):(
                    <ListView visibleEvents={visibleEvents} selectedEvent={selectedEvent} correlationMap={correlationMap} anchorEventId={anchorEventId} anchorTime={anchorTime} onTagClick={handleTagClick} activeTagFilters={activeTagFilters} onSetAnchor={handleSetAnchor} getGroupFlags={getGroupFlags}
                      onSelect={ev=>{setSelectedEvent(ev);setShowAnalysis(false);setShowAlarmAudit(false);}} />
                  )}
                </div>
              </section>
              {/* Right panel */}
              {hasIncidentPanel&&(
                <aside style={{width:320,background:"var(--surface)",overflowY:"auto",display:"flex",flexDirection:"column",minWidth:0,borderLeft:"1px solid var(--border)"}}>
                  {showAnalysis&&<AnalysisPanel analysis={analysis} loading={analysisLoading} error={analysisError} eventCount={visibleEvents.length} onClose={()=>{setShowAnalysis(false);clearAnalysis();}} onRetry={()=>runAnalysis(visibleEvents)} />}
                  {showAlarmAudit&&!showAnalysis&&<ConfigAuditPanel data={alarmAudit} loading={auditLoading} error={auditError} onClose={()=>setShowAlarmAudit(false)} onRefresh={handleAlarmAuditRefresh} />}
                  {selectedEvent&&!showAnalysis&&!showAlarmAudit&&<EventDetail event={selectedEvent} onClose={()=>setSelectedEvent(null)} contextEvents={sourceFilteredEvents} />}
                </aside>
              )}
              {!hasIncidentPanel&&(
                <aside style={{width:320,background:"var(--surface)",overflowY:"auto",display:"flex",flexDirection:"column",minWidth:0,borderLeft:"1px solid var(--border)"}}>
                  <RightPanelHint />
                </aside>
              )}
            </>
          )}

          {/* AI Summary tab */}
          {activeTab==="ai-summary" && (
            <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
              <AnalysisPanel
                analysis={analysis} loading={analysisLoading} error={analysisError}
                eventCount={visibleEvents.length}
                onClose={()=>{setActiveTab("service-map");clearAnalysis();}}
                onRetry={()=>runAnalysis(visibleEvents)}
              />
              {!analysis&&!analysisLoading&&(
                <div style={{padding:"20px 24px"}}>
                  <button onClick={()=>runAnalysis(visibleEvents)} disabled={visibleEvents.length===0}
                    style={{...btnStyle,opacity:visibleEvents.length===0?0.4:1,color:"var(--green)",border:"1px solid rgba(5,150,105,0.35)",background:"rgba(5,150,105,0.08)"}}>
                    ◈ Run AI Analysis ({visibleEvents.length} events)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Config Audit tab */}
          {activeTab==="config-audit" && (
            <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
              <ConfigAuditPanel
                data={alarmAudit} loading={auditLoading} error={auditError}
                onClose={()=>setActiveTab("service-map")}
                onRefresh={handleAlarmAuditRefresh}
              />
              {!alarmAudit&&!auditLoading&&(
                <div style={{padding:"20px 24px"}}>
                  <button onClick={loadAudit} style={{...btnStyle,color:"var(--yellow)",border:"1px solid rgba(234,179,8,0.35)",background:"rgba(234,179,8,0.07)"}}>
                    ⚙ Run Config Audit
                  </button>
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* ── Service detail slide-over ── */}
      {selectedService && <ServiceDetailPanel svc={selectedService} tab={dpTab} setTab={setDpTab} onClose={()=>setSelectedService(null)} oncall={oncall} teams={teams} onIncidentView={()=>{setActiveTab("incidents");setSvcSearch(selectedService.name);setSelectedService(null);}} />}
      <div className={`detail-backdrop${selectedService?" open":""}`} onClick={()=>setSelectedService(null)} />

      {/* ── Command Palette ── */}
      {showCmdPalette && (
        <CommandPalette
          query={cmdQuery}
          setQuery={setCmdQuery}
          onClose={()=>{setShowCmdPalette(false);setCmdQuery("");}}
          services={services}
          onAction={(action)=>{
            setShowCmdPalette(false); setCmdQuery("");
            if (action==="service-map")   { setActiveTab("service-map"); }
            else if (action==="incidents"){ setActiveTab("incidents"); }
            else if (action==="ai")       { handleTabSwitch("ai-summary"); }
            else if (action==="audit")    { handleTabSwitch("config-audit"); }
            else if (action==="brief")    { setShowBrief(true); }
            else if (action==="discover") { setShowDiscover(true); if(!discoverData&&!discoverLoading){setDiscoverLoading(true);api.discoverServices().then(d=>{setDiscoverData(d);setDiscoverLoading(false);}).catch(e=>{setDiscoverError(e.message);setDiscoverLoading(false);});} }
            else if (action.startsWith("svc:")) {
              const id = action.slice(4);
              const svc = services.find(s=>s.id===id);
              if (svc) { setSelectedService(svc); setDpTab("events"); }
            }
          }}
        />
      )}

      {/* ── Auto-discover modal ── */}
      {showDiscover && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999}} onClick={e=>{if(e.target===e.currentTarget){setShowDiscover(false);setDiscoverSaved(false);}}}>
          <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,width:"min(860px,96vw)",maxHeight:"86vh",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 24px 64px rgba(0,0,0,0.5)"}}>
            {/* Header */}
            <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:18}}>⬡</span>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:14,color:"var(--text)"}}>Auto-discover Services</div>
                <div style={{fontSize:11,color:"var(--muted)",marginTop:2}}>Scans CloudWatch alarms, PagerDuty services, Grafana dashboards & GitHub repos to build your services.yml automatically.</div>
              </div>
              <button onClick={()=>{setShowDiscover(false);setDiscoverSaved(false);}} style={{background:"none",border:"none",color:"var(--muted)",fontSize:18,cursor:"pointer",lineHeight:1}}>✕</button>
            </div>
            {/* Body */}
            <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
              {discoverLoading && (
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12,padding:"40px 0",color:"var(--muted)"}}>
                  <span style={{fontSize:28,animation:"spin 1.2s linear infinite",display:"inline-block"}}>⟳</span>
                  <div style={{fontFamily:"var(--font-mono)",fontSize:12}}>Scanning CloudWatch, PagerDuty, Grafana & GitHub…</div>
                </div>
              )}
              {discoverError && (
                <div style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:6,padding:"12px 14px",color:"var(--red)",fontFamily:"var(--font-mono)",fontSize:12}}>{discoverError}</div>
              )}
              {discoverData && !discoverLoading && (() => {
                const {summary, suggested_services: svcs, yaml, raw} = discoverData;
                return (
                  <>
                    {/* Summary pills */}
                    <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:16}}>
                      {[
                        ["☁ CloudWatch", summary.cloudwatch_alarms+" alarms → "+summary.cloudwatch_services+" groups", raw.cloudwatch?.configured],
                        ["⬡ PagerDuty",  summary.pagerduty_services+" services", raw.pagerduty?.configured],
                        ["▣ Grafana",    summary.grafana_dashboards+" dashboards", raw.grafana?.configured],
                        ["⬡ GitHub",    summary.github_repos+" repos", raw.github?.configured],
                      ].map(([src, detail, ok])=>(
                        <div key={src} style={{display:"flex",alignItems:"center",gap:6,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:6,padding:"5px 10px",fontSize:11}}>
                          <span style={{width:6,height:6,borderRadius:"50%",background:ok?"var(--green)":"var(--border-hi)",flexShrink:0}} />
                          <span style={{fontWeight:600,color:"var(--text-dim)"}}>{src}</span>
                          <span style={{color:"var(--muted)",fontFamily:"var(--font-mono)"}}>{detail}</span>
                        </div>
                      ))}
                    </div>
                    {/* Suggested services table */}
                    <div style={{marginBottom:14}}>
                      <div style={{fontFamily:"var(--font-mono)",fontSize:10,color:"var(--muted)",textTransform:"uppercase",letterSpacing:0.8,marginBottom:8}}>
                        {svcs.length} suggested services
                      </div>
                      <div style={{border:"1px solid var(--border)",borderRadius:6,overflow:"hidden"}}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 80px 90px 120px 130px 130px",background:"var(--surface2)",padding:"6px 12px",fontFamily:"var(--font-mono)",fontSize:10,color:"var(--muted)",textTransform:"uppercase",letterSpacing:0.6,gap:8}}>
                          <span>Name</span><span>Runtime</span><span>Env</span><span>PagerDuty</span><span>Grafana</span><span>GitHub</span>
                        </div>
                        {svcs.length === 0 && (
                          <div style={{padding:"20px 12px",textAlign:"center",color:"var(--muted)",fontFamily:"var(--font-mono)",fontSize:12}}>No services discovered. Check your API credentials in .env</div>
                        )}
                        {svcs.map((s,i)=>(
                          <div key={s.id} style={{display:"grid",gridTemplateColumns:"1fr 80px 90px 120px 130px 130px",padding:"7px 12px",borderTop:i>0?"1px solid var(--border)":"none",fontSize:12,alignItems:"center",gap:8}}>
                            <span style={{fontWeight:600,color:"var(--text)",fontFamily:"var(--font-mono)"}}>{s.name}</span>
                            <span style={{color:"var(--muted)",fontFamily:"var(--font-mono)",fontSize:11}}>{s.runtime}</span>
                            <span style={{color:"var(--muted)",fontFamily:"var(--font-mono)",fontSize:11}}>{s.env}</span>
                            <span style={{color:s.pagerduty_id?"var(--green)":"var(--border-hi)",fontSize:11,fontFamily:"var(--font-mono)"}} title={s._pd_name||""}>{s.pagerduty_id?("✓ "+s._pd_name?.slice(0,14)):"—"}</span>
                            <span style={{color:s.grafana_uid?"var(--green)":"var(--border-hi)",fontSize:11,fontFamily:"var(--font-mono)"}} title={s._gf_title||""}>{s.grafana_uid?("✓ "+s._gf_title?.slice(0,14)):"—"}</span>
                            <span style={{color:s.github_repo?"var(--green)":"var(--border-hi)",fontSize:11,fontFamily:"var(--font-mono)"}} title={s._gh_repo||""}>{s.github_repo?("✓ "+s._gh_repo?.slice(0,14)):"—"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* YAML preview */}
                    <div>
                      <div style={{fontFamily:"var(--font-mono)",fontSize:10,color:"var(--muted)",textTransform:"uppercase",letterSpacing:0.8,marginBottom:6}}>Generated services.yml</div>
                      <pre style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:6,padding:"12px 14px",fontFamily:"var(--font-mono)",fontSize:11,lineHeight:1.6,overflowX:"auto",maxHeight:240,color:"var(--text-dim)",margin:0,whiteSpace:"pre"}}>{yaml}</pre>
                    </div>
                    {discoverSaved && (
                      <div style={{marginTop:12,background:"rgba(16,185,129,0.1)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:6,padding:"10px 14px",fontFamily:"var(--font-mono)",fontSize:12,color:"var(--green)"}}>
                        ✓ services.yml saved. The service map will refresh on the next poll.
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
            {/* Footer */}
            <div style={{padding:"12px 20px",borderTop:"1px solid var(--border)",display:"flex",gap:8,alignItems:"center",justifyContent:"flex-end"}}>
              {discoverData && !discoverLoading && !discoverSaved && (
                <>
                  <button onClick={()=>{setDiscoverLoading(true);setDiscoverError(null);setDiscoverData(null);api.discoverServices().then(d=>{setDiscoverData(d);setDiscoverLoading(false);}).catch(e=>{setDiscoverError(e.message);setDiscoverLoading(false);});}} style={{padding:"6px 14px",borderRadius:5,background:"var(--surface2)",border:"1px solid var(--border)",color:"var(--muted)",fontSize:12,cursor:"pointer"}}>↺ Re-scan</button>
                  <button onClick={()=>{setDiscoverSaving(true);api.saveDiscoveredServices(discoverData.yaml).then(()=>{setDiscoverSaving(false);setDiscoverSaved(true);}).catch(e=>{setDiscoverSaving(false);setDiscoverError(e.message);});}} disabled={discoverSaving||discoverData?.suggested_services?.length===0} style={{padding:"6px 16px",borderRadius:5,background:"var(--blue)",border:"1px solid var(--blue)",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",opacity:discoverSaving?0.7:1}}>
                    {discoverSaving?"Saving…":"Save & apply services.yml"}
                  </button>
                </>
              )}
              {discoverSaved && (
                <button onClick={()=>{setShowDiscover(false);setDiscoverSaved(false);}} style={{padding:"6px 16px",borderRadius:5,background:"var(--green)",border:"1px solid var(--green)",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>Done</button>
              )}
              {!discoverData && !discoverLoading && (
                <button onClick={()=>{setDiscoverLoading(true);setDiscoverError(null);api.discoverServices().then(d=>{setDiscoverData(d);setDiscoverLoading(false);}).catch(e=>{setDiscoverError(e.message);setDiscoverLoading(false);});}} style={{padding:"6px 16px",borderRadius:5,background:"var(--blue)",border:"1px solid var(--blue)",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>⬡ Start Discovery</button>
              )}
              <button onClick={()=>{setShowDiscover(false);setDiscoverSaved(false);}} style={{padding:"6px 14px",borderRadius:5,background:"var(--surface2)",border:"1px solid var(--border)",color:"var(--muted)",fontSize:12,cursor:"pointer"}}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Morning Brief modal ── */}
      {showBrief && (
        <div className="brief-overlay open" onClick={e=>{if(e.target===e.currentTarget)setShowBrief(false);}}>
          <MorningBrief onClose={()=>setShowBrief(false)} events={briefEvents} loading={briefLoading} analysis={briefAnalysis} />
        </div>
      )}
    </div>
  );
}

// ── Service Card ──────────────────────────────────────────────────────────────
function ServiceCard({ svc, onClick }) {
  const sparkArr = svc.spark?.length ? svc.spark : [1];
  const max = Math.max(...sparkArr);
  const bars = sparkArr.map((v,i) => {
    const h = Math.max(2, Math.round((v/max)*26));
    const op = i < svc.spark.length-5 ? 0.3 : 0.9;
    return <div key={i} className="spark-bar" style={{height:h,background:svc.sparkColor,opacity:op}} />;
  });
  const label = svc.status==="critical"?"CRITICAL":svc.status==="warning"?"WARNING":"HEALTHY";
  return (
    <div className={`svc-card ${svc.status}`} onClick={onClick}>
      {svc.alertCount > 0 && <div className="alert-bubble">{svc.alertCount}</div>}
      <div className="card-top">
        <div className="card-icon">{svc.icon}</div>
        <div className="card-info">
          <div className="card-name">{svc.name}</div>
          <div className="card-runtime">▣ {svc.runtime}</div>
        </div>
        <span className={`status-badge ${svc.status}`}>{label}</span>
      </div>
      <div className="card-spark">{bars}</div>
      <div className="card-metrics">
        {svc.metrics.map((m,i)=>(
          <div key={i} className="metric-cell">
            <div className="metric-val" style={{color:m.color}}>{m.val}</div>
            <div className="metric-lbl">{m.lbl}</div>
          </div>
        ))}
      </div>
      <div className="card-sources">
        {svc.sources.map((s,i)=>(
          <span key={i} className="src-chip" style={{background:s.color+"18",color:s.color,border:`1px solid ${s.color}30`}}>{s.name}</span>
        ))}
        <span className={`card-last-evt${svc.lastEvtAlert?" has-alert":""}`}>{svc.lastEvtAlert?"⚠ ":""}{svc.lastEvt}</span>
      </div>
    </div>
  );
}

// ── Service Detail Panel ──────────────────────────────────────────────────────
// ── Severity helpers ─────────────────────────────────────────────────────────
const SEV_COLOR = { critical:"#f87171", warning:"#fbbf24", info:"#60a5fa", success:"#10b981" };
const SRC_ICON  = { cloudwatch:"☁", grafana:"◈", pagerduty:"🔔", github:"⬡", datadog:"◉" };

function _fmtTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso.replace("Z","+00:00"));
    const now = Date.now();
    const diff = Math.floor((now - d.getTime()) / 1000);
    if (diff < 60)   return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400)return `${Math.floor(diff/3600)}h ago`;
    return d.toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
  } catch { return ""; }
}

function ServiceDetailPanel({ svc, tab, setTab, onClose, oncall, teams, onIncidentView }) {
  // ── Live timeline state ────────────────────────────────────────────────────
  const [timeline,        setTimeline]        = React.useState(null);   // {events, related_services, window}
  const [timelineLoading, setTimelineLoading] = React.useState(false);
  const [timelineError,   setTimelineError]   = React.useState(null);
  const [windowHours,     setWindowHours]     = React.useState(4);

  // Fetch timeline whenever the service changes or window changes
  React.useEffect(() => {
    if (!svc?.id) return;
    let cancelled = false;
    setTimelineLoading(true);
    setTimelineError(null);
    api.getServiceTimeline(svc.id, windowHours)
      .then(data => { if (!cancelled) { setTimeline(data); setTimelineLoading(false); } })
      .catch(e  => { if (!cancelled) { setTimelineError(e.message); setTimelineLoading(false); } });
    return () => { cancelled = true; };
  }, [svc?.id, windowHours]);

  // Auto-switch to Events tab when timeline loads with events
  React.useEffect(() => {
    if (timeline?.events?.length > 0 && tab === "metrics") setTab("events");
  }, [timeline]); // eslint-disable-line

  // ── On-call lookup ─────────────────────────────────────────────────────────
  const svcNameLower = (svc.name || "").toLowerCase();
  const ocEntry = oncall?.find(o =>
    (o.escalation_policy || "").toLowerCase().includes(svcNameLower) ||
    (o.escalation_policy || "").toLowerCase().includes((svc.team || "").toLowerCase())
  ) || oncall?.[0];

  const oc = ocEntry ? {
    initials: (ocEntry.user_name || "?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2),
    name:     ocEntry.user_name || "Unknown",
    role:     `${ocEntry.escalation_policy || "On-call"} · ${ocEntry.schedule || ""}`.replace(/ · $/, ""),
    bg:       "#2563eb",
    email:    ocEntry.user_email || "",
    pdUrl:    ocEntry.pd_url || "",
    end:      ocEntry.end || "",
  } : { initials:"?", name:"Not configured", role:"PagerDuty not connected", bg:"#475569", email:"", pdUrl:"", end:"" };

  const teamName = (teams || []).find(t=>t.id===svc.team)?.name || svc.team || "";
  const label = svc.status==="critical"?"CRITICAL":svc.status==="warning"?"WARNING":"HEALTHY";

  // ── Events tab: window selector ────────────────────────────────────────────
  const windowOpts = [{label:"1h",val:1},{label:"4h",val:4},{label:"12h",val:12},{label:"24h",val:24},{label:"7d",val:168}];
  return (
    <div className="detail-panel open">
      <div className="dp-header">
        <div className="dp-header-top">
          <div className="dp-icon">{svc.icon}</div>
          <div className="dp-title-block">
            <div className="dp-name">{svc.name}</div>
            <div className="dp-breadcrumb">{svc.runtime} · {svc.env} · {teamName}</div>
          </div>
          <button className="dp-close" onClick={onClose}>×</button>
        </div>
        <div className="dp-status-row">
          <span className={`dp-status-pill ${svc.status}`}>{label}</span>
          {svc.alertCount>0&&<span className="dp-alert-count">{svc.alertCount} active alert{svc.alertCount>1?"s":""}</span>}
          <div className="dp-oncall-strip" onClick={()=>setTab("oncall")}>
            <div className="dp-oncall-avatar" style={{background:oc.bg}}>{oc.initials}</div>
            <div className="dp-oncall-info">
              <div className="dp-oncall-name">{oc.name.split(" ")[0]} {oc.name.split(" ")[1]?.[0]}.</div>
              <div className="dp-oncall-lbl">On-call now</div>
            </div>
          </div>
        </div>
      </div>
      <div className="dp-tabs">
        {["metrics","events","deploy","oncall"].map(t=>(
          <button key={t} className={`dp-tab${tab===t?" active":""}`} onClick={()=>setTab(t)}>
            {t==="metrics" ? "Metrics"
              : t==="events" ? <>Events{timeline?.events?.length>0&&<span style={{marginLeft:4,fontSize:10,opacity:.7}}>({timeline.events.length})</span>}</>
              : t==="deploy" ? "Deploy Watch"
              : "On-call"}
          </button>
        ))}
      </div>
      <div className="dp-body">
        <div className={`dp-tab-content${tab==="metrics"?" active":""}`}>
          <div className="dp-section">
            <div className="dp-section-lbl">Live metrics</div>
            <div className="dp-metric-grid">
              {svc.metrics.map((m,i)=>(
                <div key={i} className="dp-metric">
                  <div className="dp-metric-val" style={{color:m.color}}>{m.val}</div>
                  <div className="dp-metric-lbl">{m.lbl}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className={`dp-tab-content${tab==="events"?" active":""}`}>
          {/* ── Window selector ── */}
          <div style={{display:"flex",alignItems:"center",gap:6,padding:"8px 16px 0",borderBottom:"1px solid var(--border)"}}>
            <span style={{fontSize:11,color:"var(--muted)",fontFamily:"var(--font-mono)"}}>Window:</span>
            {windowOpts.map(o=>(
              <button key={o.val} onClick={()=>setWindowHours(o.val)}
                style={{fontSize:11,padding:"2px 8px",borderRadius:4,border:"1px solid var(--border)",
                  background: windowHours===o.val ? "var(--accent)" : "transparent",
                  color: windowHours===o.val ? "#fff" : "var(--muted)", cursor:"pointer"}}>
                {o.label}
              </button>
            ))}
            {timelineLoading && <span style={{fontSize:10,color:"var(--muted)",marginLeft:"auto",fontFamily:"var(--font-mono)"}}>⟳ loading…</span>}
          </div>

          {/* ── This service's unified timeline ── */}
          <div className="dp-section" style={{paddingTop:10}}>
            <div className="dp-section-lbl">
              Unified timeline · {svc.name}
              {timeline?.events && <span style={{color:"var(--muted)",fontWeight:400}}> ({timeline.events.length} events)</span>}
            </div>

            {timelineError && (
              <div style={{color:"var(--red)",fontSize:11,fontFamily:"var(--font-mono)",padding:"6px 0"}}>
                ⚠ {timelineError}
              </div>
            )}

            <div className="dp-event-list">
              {!timeline && !timelineLoading && (
                <div style={{color:"var(--muted)",fontSize:12,fontFamily:"var(--font-mono)",padding:"8px 0"}}>
                  Configure cloudwatch.alarm_prefix / github.repo / pagerduty.service_id in services.yml to see events.
                </div>
              )}
              {timeline?.events?.length === 0 && !timelineLoading && (
                <div style={{color:"var(--green)",fontSize:12,fontFamily:"var(--font-mono)",padding:"8px 0"}}>
                  ✓ No events in last {windowHours}h · All clear
                </div>
              )}
              {(timeline?.events || []).map((ev,i) => (
                <div key={ev.id || i} className="dp-event">
                  <div className="dp-event-dot" style={{background: SEV_COLOR[ev.severity] || "#64748b"}} />
                  <div style={{flex:1,minWidth:0}}>
                    <div className="dp-event-title" style={{display:"flex",alignItems:"center",gap:6}}>
                      <span style={{fontSize:10,color:"var(--muted)",fontFamily:"var(--font-mono)",flexShrink:0}}>
                        {SRC_ICON[ev.source] || "·"} {ev.source}
                      </span>
                      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ev.title}</span>
                    </div>
                    <div className="dp-event-meta" style={{display:"flex",alignItems:"center",gap:8}}>
                      <span>{_fmtTime(ev.time)}</span>
                      {ev.url && <a href={ev.url} target="_blank" rel="noreferrer" style={{color:"var(--accent)",textDecoration:"none",fontSize:10}}>↗ open</a>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Cross-service correlation ── */}
          {timeline?.related_services?.length > 0 && (
            <div className="dp-section" style={{borderTop:"1px solid var(--border)",paddingTop:12,marginTop:4}}>
              <div className="dp-section-lbl" style={{color:"var(--yellow)"}}>
                ⚡ Related activity in same window ({timeline.related_services.length} other service{timeline.related_services.length!==1?"s":""})
              </div>
              {timeline.related_services.map(rel => (
                <div key={rel.id} style={{marginBottom:10}}>
                  <div style={{fontSize:11,fontWeight:600,color:"var(--text-2)",fontFamily:"var(--font-mono)",marginBottom:4,display:"flex",alignItems:"center",gap:6}}>
                    <span>{rel.icon}</span>
                    <span>{rel.name}</span>
                    <span style={{color:"var(--muted)",fontWeight:400,fontSize:10}}>· {rel.team}</span>
                    <span style={{marginLeft:"auto",fontSize:10,color:"var(--muted)"}}>
                      {rel.events.length} event{rel.events.length!==1?"s":""}
                    </span>
                  </div>
                  {rel.events.map((ev,i) => (
                    <div key={ev.id||i} style={{display:"flex",alignItems:"flex-start",gap:6,padding:"3px 0 3px 8px",borderLeft:"2px solid var(--border)"}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:SEV_COLOR[ev.severity]||"#64748b",flexShrink:0,marginTop:4}} />
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:11,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ev.title}</div>
                        <div style={{fontSize:10,color:"var(--muted)",fontFamily:"var(--font-mono)",display:"flex",gap:6}}>
                          <span>{_fmtTime(ev.time)}</span>
                          <span>· {ev.source}</span>
                          {ev.url && <a href={ev.url} target="_blank" rel="noreferrer" style={{color:"var(--accent)",textDecoration:"none"}}>↗</a>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className={`dp-tab-content${tab==="deploy"?" active":""}`}>
          <div className="dp-section">
            {svc.deploy?.last_deploy_ref ? (
              <>
                <div className="dp-section-lbl">
                  Deploy: {svc.deploy.last_deploy_ref} → {svc.deploy.last_deploy_env || "production"} · {svc.deploy.last_deploy_ago}
                </div>
                <div className={`dw-verdict ${svc.deploy.last_deploy_status === "success" ? "good" : svc.deploy.last_deploy_status === "failure" ? "bad" : ""}`}>
                  <span className="dw-verdict-icon">{svc.deploy.last_deploy_status === "success" ? "✓" : svc.deploy.last_deploy_status === "failure" ? "⚠" : "⏳"}</span>
                  <div>
                    <div className="dw-verdict-title" style={{color: svc.deploy.last_deploy_status === "failure" ? "var(--red)" : svc.deploy.last_deploy_status === "success" ? "var(--green)" : "var(--yellow)"}}>
                      Deploy {svc.deploy.last_deploy_status?.toUpperCase() || "PENDING"}
                    </div>
                    <div className="dw-verdict-sub">
                      Ref: {svc.deploy.last_deploy_ref}
                      {svc.deploy.last_deploy_by && ` · by @${svc.deploy.last_deploy_by}`}
                    </div>
                  </div>
                </div>
                <div className="dp-section-lbl" style={{marginTop:12}}>Alarm state after deploy</div>
                {svc.alarms?.filter(a=>a.state==="ALARM").length > 0 ? (
                  <div className="dp-event-list">
                    {svc.alarms.filter(a=>a.state==="ALARM").map((a,i)=>(
                      <div key={i} className="dp-event">
                        <div className="dp-event-dot" style={{background:"var(--red)"}} />
                        <div>
                          <div className="dp-event-title">{a.name}</div>
                          <div className="dp-event-meta">CloudWatch · ALARM</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{color:"var(--green)",fontSize:12,fontFamily:"var(--font-mono)",padding:"8px 0"}}>✓ No alarms firing after deploy</div>
                )}
                {svc.deploy.last_deploy_url && (
                  <a className="dp-btn dp-btn-secondary" href={svc.deploy.last_deploy_url} target="_blank" rel="noreferrer" style={{display:"inline-block",marginTop:12,textDecoration:"none"}}>
                    ↗ View on GitHub
                  </a>
                )}
              </>
            ) : (
              <div style={{color:"var(--muted)",fontSize:12,fontFamily:"var(--font-mono)",padding:"8px 0"}}>
                No GitHub repo configured for this service.{" "}
                <span style={{color:"var(--text-2)"}}>Add a <code>github.repo</code> entry in services.yml.</span>
              </div>
            )}
          </div>
        </div>
        <div className={`dp-tab-content${tab==="oncall"?" active":""}`}>
          <div className="dp-section">
            <div className="dp-section-lbl">Current on-call</div>
            <div className="oncall-card">
              <div className="oncall-person">
                <div className="oncall-avatar-lg" style={{background:oc.bg}}>{oc.initials}</div>
                <div><div className="oncall-person-name">{oc.name}</div><div className="oncall-person-role">{oc.role}</div></div>
              </div>
              <div className="oncall-links">
                {oc.email && (
                  <div className="oncall-link">
                    <span className="oncall-link-icon">✉</span>
                    <span className="oncall-link-label">{oc.email}</span>
                    <span className="oncall-link-sub">Email</span>
                  </div>
                )}
                {oc.end && (
                  <div className="oncall-link">
                    <span className="oncall-link-icon">🕐</span>
                    <span className="oncall-link-label">Until {new Date(oc.end).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</span>
                    <span className="oncall-link-sub">Shift end</span>
                  </div>
                )}
                {oc.pdUrl && (
                  <a href={oc.pdUrl} target="_blank" rel="noreferrer" className="oncall-link" style={{textDecoration:"none",color:"inherit"}}>
                    <span className="oncall-link-icon">🔔</span>
                    <span className="oncall-link-label">PagerDuty</span>
                    <span className="oncall-link-sub">{oc.role}</span>
                    <span className="oncall-link-arrow">↗</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="dp-footer">
        <button className="dp-btn dp-btn-primary" onClick={onIncidentView}>→ Incident View</button>
        {svc.deploy?.last_deploy_url && (
          <a href={svc.deploy.last_deploy_url} target="_blank" rel="noreferrer"
            className="dp-btn dp-btn-danger" style={{textDecoration:"none",display:"inline-flex",alignItems:"center",gap:4}}>
            ⬅ View on GitHub
          </a>
        )}
        <button className="dp-btn dp-btn-secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ── Command Palette ──────────────────────────────────────────────────────────
const CMD_ACTIONS = [
  { id:"service-map", icon:"⬡", label:"Service Map",      sub:"View all services",               kbd:"" },
  { id:"incidents",   icon:"≡", label:"Incidents",         sub:"Browse the event timeline",        kbd:"" },
  { id:"ai",          icon:"◈", label:"AI Analysis",       sub:"Run root-cause analysis",          kbd:"A" },
  { id:"audit",       icon:"⚙", label:"Config Audit",      sub:"Check all source configurations",  kbd:"U" },
  { id:"brief",       icon:"☀", label:"Morning Brief",     sub:"Overnight summary 01:00–09:00",    kbd:"B" },
  { id:"discover",    icon:"⬡", label:"Auto-discover",     sub:"Scan APIs to build services.yml",  kbd:"" },
];
function CommandPalette({ query, setQuery, onClose, services, onAction }) {
  const inputRef = React.useRef(null);
  const [activeIdx, setActiveIdx] = React.useState(0);
  React.useEffect(() => { setTimeout(()=>inputRef.current?.focus(), 50); }, []);

  const q = query.toLowerCase();
  const filteredActions = CMD_ACTIONS.filter(a =>
    !q || a.label.toLowerCase().includes(q) || a.sub.toLowerCase().includes(q)
  );
  const critSvcs = services.filter(s => s.status==="critical"||s.status==="warning")
    .filter(s => !q || s.name.toLowerCase().includes(q))
    .slice(0, 5);
  const allItems = [
    ...filteredActions.map(a=>({type:"action",...a})),
    ...critSvcs.map(s=>({type:"svc", id:"svc:"+s.id, icon:s.icon||"⬡",
      label:s.name, sub:`${s.runtime} · ${s.status.toUpperCase()}`, kbd:""})),
  ];
  const totalItems = allItems.length;

  React.useEffect(() => { setActiveIdx(0); }, [query]);

  const handleKey = (e) => {
    if (e.key==="Escape")     { e.preventDefault(); onClose(); }
    if (e.key==="ArrowDown")  { e.preventDefault(); setActiveIdx(i=>Math.min(i+1,totalItems-1)); }
    if (e.key==="ArrowUp")    { e.preventDefault(); setActiveIdx(i=>Math.max(i-1,0)); }
    if (e.key==="Enter" && allItems[activeIdx]) { onAction(allItems[activeIdx].id); }
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",backdropFilter:"blur(3px)",display:"flex",alignItems:"flex-start",justifyContent:"center",paddingTop:"12vh",zIndex:10000}} onClick={onClose}>
      <div style={{width:"min(560px,96vw)",background:"var(--surface)",border:"1px solid var(--border-hi)",borderRadius:10,boxShadow:"0 24px 60px rgba(0,0,0,0.6)",overflow:"hidden",animation:"popIn 0.1s ease"}} onClick={e=>e.stopPropagation()}>
        {/* Search */}
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"14px 16px",borderBottom:"1px solid var(--border)"}}>
          <span style={{fontSize:16,color:"var(--muted)"}}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e=>setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Type a command or search services…"
            style={{flex:1,background:"none",border:"none",outline:"none",fontFamily:"var(--font-sans)",fontSize:15,color:"var(--text)",caretColor:"var(--blue)"}}
          />
          <span style={{fontSize:10,fontFamily:"var(--font-mono)",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:3,padding:"2px 7px",color:"var(--muted)"}}>ESC</span>
        </div>
        {/* Results */}
        <div style={{maxHeight:340,overflowY:"auto"}}>
          {filteredActions.length > 0 && (
            <>
              <div style={{fontSize:9,fontFamily:"var(--font-mono)",textTransform:"uppercase",letterSpacing:1,color:"var(--muted)",padding:"10px 16px 5px"}}>Actions</div>
              {filteredActions.map((item,i)=>(
                <div key={item.id} onMouseEnter={()=>setActiveIdx(i)} onClick={()=>onAction(item.id)}
                  style={{display:"flex",alignItems:"center",gap:10,padding:"9px 16px",cursor:"pointer",background:activeIdx===i?"rgba(96,165,250,0.1)":"transparent",transition:"background 0.07s"}}>
                  <span style={{fontSize:13,width:20,textAlign:"center",flexShrink:0,color:"var(--muted)"}}>{item.icon}</span>
                  <span style={{flex:1,fontSize:13,color:"var(--text)"}}>{item.label}</span>
                  <span style={{fontSize:11,color:"var(--muted)",fontFamily:"var(--font-mono)"}}>{item.sub}</span>
                  {item.kbd && <span style={{fontSize:10,fontFamily:"var(--font-mono)",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:3,padding:"1px 6px",color:"var(--muted)"}}>{item.kbd}</span>}
                </div>
              ))}
            </>
          )}
          {critSvcs.length > 0 && (
            <>
              <div style={{fontSize:9,fontFamily:"var(--font-mono)",textTransform:"uppercase",letterSpacing:1,color:"var(--red)",padding:"10px 16px 5px"}}>⚠ Degraded Services</div>
              {critSvcs.map((s,i)=>{
                const idx = filteredActions.length + i;
                return (
                  <div key={s.id} onMouseEnter={()=>setActiveIdx(idx)} onClick={()=>onAction("svc:"+s.id)}
                    style={{display:"flex",alignItems:"center",gap:10,padding:"9px 16px",cursor:"pointer",background:activeIdx===idx?"rgba(96,165,250,0.1)":"transparent",transition:"background 0.07s"}}>
                    <span style={{fontSize:13,width:20,textAlign:"center",flexShrink:0}}>{s.icon||"⬡"}</span>
                    <span style={{flex:1,fontSize:13,color:"var(--text)",fontFamily:"var(--font-mono)"}}>{s.name}</span>
                    <span style={{fontSize:11,color:s.status==="critical"?"var(--red)":"var(--yellow)",fontFamily:"var(--font-mono)"}}>{s.runtime} · {s.status.toUpperCase()}</span>
                  </div>
                );
              })}
            </>
          )}
          {allItems.length === 0 && (
            <div style={{padding:"24px 16px",textAlign:"center",color:"var(--muted)",fontFamily:"var(--font-mono)",fontSize:12}}>No results for "{query}"</div>
          )}
        </div>
        {/* Footer */}
        <div style={{padding:"8px 16px",borderTop:"1px solid var(--border)",display:"flex",gap:14}}>
          {[["↑↓","navigate"],["↵","select"],["ESC","close"]].map(([k,d])=>(
            <div key={k} style={{fontSize:10,fontFamily:"var(--font-mono)",color:"var(--muted)",display:"flex",alignItems:"center",gap:4}}>
              <kbd style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:3,padding:"1px 5px"}}>{k}</kbd> {d}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Morning Brief Modal ───────────────────────────────────────────────────────
const BRIEF_SEV_COLOR = { critical:"var(--red)", warning:"var(--yellow)", info:"var(--blue)", success:"var(--green)" };
function MorningBrief({ onClose, events, loading, analysis }) {
  const now  = new Date();
  // Window: today 01:00 → 09:00 (or yesterday if before 9am)
  const startH = new Date(now); startH.setHours(1,0,0,0);
  const endH   = new Date(now); endH.setHours(9,0,0,0);
  if (now.getHours() < 9) { startH.setDate(startH.getDate()-1); endH.setDate(endH.getDate()-1); }
  const fmt = d => d.toLocaleString([],{month:"short",day:"numeric"});
  const fmtT = d => d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",hour12:false});
  const subtitle = `Overnight · ${fmt(startH)} · ${fmtT(startH)}–${fmtT(endH)}`;

  const critical  = events.filter(e=>e.severity==="critical").length;
  const warnings  = events.filter(e=>e.severity==="warning").length;
  const resolved  = events.filter(e=>e.severity==="success").length;
  const deploys   = events.filter(e=>e.source==="github"&&e.title?.toLowerCase().includes("deploy")).length;
  const aiText    = analysis?.analysis?.root_cause || analysis?.analysis?.timeline_summary || null;

  return (
    <div className="brief-modal">
      <div className="brief-header">
        <div><div className="brief-title">☀ Morning Brief</div><div className="brief-subtitle">{subtitle}</div></div>
        <button className="brief-close" onClick={onClose}>×</button>
      </div>
      <div className="brief-body">
        {loading && (
          <div style={{textAlign:"center",padding:"30px 0",color:"var(--muted)",fontFamily:"var(--font-mono)",fontSize:12}}>
            ⟳ Loading overnight events…
          </div>
        )}
        {!loading && (
          <>
            <div className="brief-ai-box">
              <div className="brief-ai-label">◈ AI Summary</div>
              {aiText
                ? <div className="brief-ai-text">{aiText}</div>
                : events.length === 0
                  ? <div className="brief-ai-text">✓ No events detected overnight. All services were healthy during this window.</div>
                  : <div className="brief-ai-text" style={{color:"var(--muted)"}}>AI analysis loading…</div>
              }
            </div>
            <div>
              <div className="brief-section-lbl">Overnight summary</div>
              <div className="brief-summary-row">
                {[
                  {val:critical,  lbl:"Critical",      c:"var(--red)"},
                  {val:warnings,  lbl:"Warnings",      c:"var(--yellow)"},
                  {val:resolved,  lbl:"Auto-resolved", c:"var(--green)"},
                  {val:deploys,   lbl:"Deploys",       c:"var(--purple)"},
                ].map(({val,lbl,c})=>(
                  <div key={lbl} className="brief-stat">
                    <div className="brief-stat-val" style={{color:c}}>{val}</div>
                    <div className="brief-stat-lbl">{lbl}</div>
                  </div>
                ))}
              </div>
            </div>
            {events.length > 0 && (
              <div>
                <div className="brief-section-lbl">Timeline</div>
                <div className="brief-timeline">
                  {events.map((ev,i)=>{
                    const t = new Date(ev.time);
                    const tStr = fmtT(t);
                    const c = BRIEF_SEV_COLOR[ev.severity] || "var(--muted)";
                    return (
                      <div key={ev.id||i} className="brief-evt">
                        <div className="brief-evt-time">{tStr}</div>
                        <div className="brief-evt-dot" style={{background:c}} />
                        <div className="brief-evt-body">
                          <div className="brief-evt-title">{ev.title}</div>
                          <div className="brief-evt-meta">{ev.source}{ev.tags?.length?" · "+ev.tags.slice(0,3).join(", "):""}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {events.length === 0 && !loading && (
              <div style={{textAlign:"center",padding:"20px 0",color:"var(--muted)",fontFamily:"var(--font-mono)",fontSize:12}}>
                No events found in this window.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── List view ─────────────────────────────────────────────────────────────────
function ListView({ visibleEvents, selectedEvent, correlationMap, anchorEventId, anchorTime, onTagClick, activeTagFilters, onSetAnchor, getGroupFlags, onSelect }) {
  return (
    <div>
      {visibleEvents.map((event,i)=>{
        const groupFlags = getGroupFlags(event.id,i,visibleEvents);
        return <TimelineEvent key={event.id||i} event={event} isSelected={selectedEvent?.id===event.id} onClick={()=>onSelect(event)} animDelay={Math.min(i*0.01,0.25)} onTagClick={onTagClick} activeTagFilters={activeTagFilters} anchorTime={anchorTime} isAnchor={event.id===anchorEventId} onSetAnchor={onSetAnchor} {...groupFlags} />;
      })}
      <div style={{height:40}} />
    </div>
  );
}

// ── Swim-lane view ────────────────────────────────────────────────────────────
function LanesView({ visibleEvents, activeSources, selectedEvent, correlationMap, anchorEventId, anchorTime, onTagClick, activeTagFilters, onSetAnchor, onSelect }) {
  const bySource = useMemo(()=>{
    const g={};
    for (const src of activeSources) g[src]=[];
    for (const e of visibleEvents) { if (g[e.source]) g[e.source].push(e); }
    return g;
  },[visibleEvents,activeSources]);
  return (
    <div style={{paddingBottom:40}}>
      {activeSources.map(src=>{
        const m=SOURCE_META[src]??{color:"#8896a8",label:src,icon:"●"};
        const evs=bySource[src]??[];
        return (
          <div key={src} style={{marginBottom:2}}>
            <div style={{padding:"7px 16px",background:"var(--bg)",borderBottom:"1px solid var(--border)",borderTop:"1px solid var(--border)",display:"flex",alignItems:"center",gap:8,position:"sticky",top:0,zIndex:5}}>
              <span style={{fontSize:11}}>{m.icon}</span>
              <span style={{fontFamily:"var(--font-mono)",fontSize:11,fontWeight:700,color:m.color}}>{m.label}</span>
              <span style={{fontFamily:"var(--font-mono)",fontSize:10,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:10,padding:"1px 7px",color:"var(--muted)"}}>{evs.length} event{evs.length!==1?"s":""}</span>
            </div>
            {evs.length===0?(
              <div style={{padding:"16px",fontSize:12,color:"var(--muted)",textAlign:"center",fontStyle:"italic"}}>No events in this window</div>
            ):evs.map((event,i)=>{
              const corrInfo=correlationMap.get(event.id);
              return <TimelineEvent key={event.id||i} event={event} isSelected={selectedEvent?.id===event.id} onClick={()=>onSelect(event)} animDelay={0} onTagClick={onTagClick} activeTagFilters={activeTagFilters} anchorTime={anchorTime} isAnchor={event.id===anchorEventId} onSetAnchor={onSetAnchor} isInGroup={!!corrInfo} correlationGroupId={corrInfo?.groupId} correlationColor={corrInfo?.color} isFirstInGroup={i===0||correlationMap.get(evs[i-1]?.id)?.groupId!==corrInfo?.groupId} isLastInGroup={i===evs.length-1||correlationMap.get(evs[i+1]?.id)?.groupId!==corrInfo?.groupId} />;
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const inputStyle = { background:"var(--bg)", border:"1px solid var(--border-hi)", borderRadius:5, padding:"4px 8px", color:"var(--text-dim)", fontSize:11, fontFamily:"var(--font-mono)", outline:"none" };
const btnStyle   = { display:"inline-flex", alignItems:"center", gap:5, padding:"5px 11px", borderRadius:6, background:"transparent", border:"1px solid var(--border-hi)", color:"var(--text-dim)", fontSize:11, fontFamily:"var(--font-mono)", fontWeight:600, cursor:"pointer", transition:"all 0.12s", whiteSpace:"nowrap" };
const sidebarLabelStyle = { fontFamily:"var(--font-mono)", fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:0.8, marginBottom:8, display:"block" };

// ── Helper components ─────────────────────────────────────────────────────────
function RightPanelHint() {
  const steps = [
    {icon:"←",title:"Click any event",desc:"See full detail, raw metadata, deploy diff, and nearby events."},
    {icon:"⊙",title:"Right-click → Set T=0",desc:"Pin any event as the incident start. All timestamps become relative deltas."},
    {icon:"◈",title:"AI Analysis",desc:"Sends all visible events to Claude — returns risk score, root cause, contributing factors."},
    {icon:"⊟",title:"Swim-lane view",desc:"Toggle ☰/⊟ to group events by source. See the blast radius across your stack."},
    {icon:"#",title:"Click any tag to filter",desc:"Instantly narrow the timeline to events sharing that service or component tag."},
    {icon:"⎘",title:"Share button",desc:"Copies a URL with your exact time window, filters, and selected event."},
  ];
  return (
    <div style={{padding:"20px 18px",display:"flex",flexDirection:"column",gap:16}}>
      <div style={{fontFamily:"var(--font-mono)",fontSize:10,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1}}>Get started</div>
      {steps.map(({icon,title,desc})=>(
        <div key={title} style={{display:"flex",alignItems:"flex-start",gap:12}}>
          <div style={{width:30,height:30,borderRadius:6,flexShrink:0,background:"var(--surface2)",border:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:"var(--text-dim)"}}>{icon}</div>
          <div><div style={{fontSize:12,fontWeight:600,color:"var(--text)",marginBottom:3}}>{title}</div><div style={{fontSize:11,color:"var(--text-dim)",lineHeight:1.6}}>{desc}</div></div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ loading }) {
  return (
    <div style={{padding:80,textAlign:"center"}}>
      {loading?(<><Spinner size={28} color="var(--blue)"/><p style={{color:"var(--muted)",marginTop:20,fontSize:13}}>Loading events…</p></>):(
        <><div style={{fontSize:36,marginBottom:14,opacity:0.2,color:"var(--text)"}}>◎</div><p style={{color:"var(--muted)",fontSize:14}}>No events found</p><p style={{color:"var(--border-hi)",fontSize:12,marginTop:6}}>Try expanding the time range or check your source configuration.</p></>
      )}
    </div>
  );
}

// ── AI Analysis panel ─────────────────────────────────────────────────────────
function AnalysisPanel({ analysis, loading, error, eventCount, onClose, onRetry }) {
  const a = analysis?.analysis;
  return (
    <div style={{height:"100%",display:"flex",flexDirection:"column"}}>
      <div style={{padding:"13px 18px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:8,flexShrink:0,background:"var(--surface)"}}>
        <span style={{color:"var(--green)",fontSize:13}}>◈</span>
        <span style={{fontFamily:"var(--font-mono)",fontSize:12,fontWeight:600,color:"var(--text)"}}>AI Root-Cause Analysis</span>
        {!loading&&!error&&a&&<span style={{fontFamily:"var(--font-mono)",fontSize:10,color:"var(--muted)",marginLeft:4}}>({eventCount} events)</span>}
        <button onClick={onClose} style={{marginLeft:"auto",background:"none",border:"none",color:"var(--muted)",fontSize:18,cursor:"pointer",lineHeight:1}} onMouseEnter={e=>e.target.style.color="var(--text)"} onMouseLeave={e=>e.target.style.color="var(--muted)"}>×</button>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"20px 18px 32px"}}>
        {loading&&(<div style={{textAlign:"center",paddingTop:60}}><Spinner size={28} color="var(--blue)"/><p style={{color:"var(--muted)",marginTop:20,fontSize:13}}>Analyzing {eventCount} events…</p><p style={{color:"var(--border-hi)",fontSize:11,marginTop:6,fontFamily:"var(--font-mono)"}}>Claude is reading the incident timeline</p></div>)}
        {error&&!loading&&(<div style={{display:"flex",flexDirection:"column",gap:12}}><ErrorBanner error={error}/><button onClick={onRetry} style={{...btnStyle,alignSelf:"flex-start"}}>↺ Retry analysis</button></div>)}
        {a&&!loading&&(
          <div style={{display:"flex",flexDirection:"column",gap:20}}>
            <div style={{display:"flex",alignItems:"center",gap:16,padding:"14px 16px",background:"var(--bg)",border:"1px solid var(--border)",borderRadius:8}}>
              <svg width={56} height={56} viewBox="0 0 56 56" style={{flexShrink:0}}>
                <circle cx="28" cy="28" r="22" fill="none" stroke="var(--border)" strokeWidth="5"/>
                <circle cx="28" cy="28" r="22" fill="none" stroke={a.risk_score>=7?"var(--red)":a.risk_score>=4?"var(--yellow)":"var(--green)"} strokeWidth="5" strokeDasharray={`${(a.risk_score/10)*138.2} 138.2`} strokeDashoffset="34.55" strokeLinecap="round" transform="rotate(-90 28 28)" style={{transition:"stroke-dasharray 0.5s ease"}}/>
                <text x="28" y="33" textAnchor="middle" fontSize="14" fontWeight="600" fill={a.risk_score>=7?"var(--red)":a.risk_score>=4?"var(--yellow)":"var(--green)"} fontFamily="var(--font-mono)">{a.risk_score}</text>
              </svg>
              <div>
                <div style={{fontFamily:"var(--font-mono)",fontSize:9,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Risk Score</div>
                <div style={{fontFamily:"var(--font-mono)",fontSize:26,fontWeight:700,lineHeight:1,color:a.risk_score>=7?"var(--red)":a.risk_score>=4?"var(--yellow)":"var(--green)"}}>{a.risk_score}<span style={{fontSize:13,color:"var(--muted)",fontWeight:400}}>/10</span></div>
                <div style={{fontSize:11,marginTop:4,color:a.risk_score>=7?"var(--red)":a.risk_score>=4?"var(--yellow)":"var(--green)"}}>{a.risk_score>=7?"High severity":a.risk_score>=4?"Medium severity":"Low severity"}</div>
              </div>
            </div>
            <ASection title="Root Cause" content={a.root_cause} accent="var(--red)"/>
            {a.key_insight&&<div><ALabel>Key Insight</ALabel><div style={{padding:"11px 14px",background:"rgba(37,99,235,0.07)",borderRadius:"0 6px 6px 0",border:"1px solid var(--border)",borderLeft:"3px solid var(--blue)",fontSize:13,lineHeight:1.65,color:"var(--text)",fontStyle:"italic"}}>{a.key_insight}</div></div>}
            <ASection title="Timeline Summary" content={a.timeline_summary} accent="var(--purple)"/>
            {a.contributing_factors?.length>0&&(<div><ALabel>Contributing Factors</ALabel><div style={{display:"flex",flexDirection:"column",gap:6}}>{a.contributing_factors.map((f,i)=><div key={i} style={{display:"flex",gap:8}}><span style={{fontFamily:"var(--font-mono)",color:"var(--yellow)",flexShrink:0,fontSize:11,paddingTop:2}}>▸</span><span style={{color:"var(--text-dim)",fontSize:13,lineHeight:1.55}}>{f}</span></div>)}</div></div>)}
            {a.next_steps?.length>0&&(<div><ALabel>Next Steps</ALabel><div style={{display:"flex",flexDirection:"column",gap:8}}>{a.next_steps.map((s,i)=><div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}><span style={{fontFamily:"var(--font-mono)",fontSize:10,color:"var(--green)",background:"rgba(5,150,105,0.1)",border:"1px solid rgba(5,150,105,0.25)",borderRadius:4,padding:"1px 6px",flexShrink:0,marginTop:2}}>{String(i+1).padStart(2,"0")}</span><span style={{color:"var(--text-dim)",fontSize:13,lineHeight:1.55}}>{s}</span></div>)}</div></div>)}
          </div>
        )}
      </div>
    </div>
  );
}
function ALabel({ children }) { return <div style={{fontFamily:"var(--font-mono)",fontSize:10,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>{children}</div>; }
function ASection({ title, content, accent }) {
  if (!content) return null;
  return <div><ALabel>{title}</ALabel><div style={{padding:"11px 14px",background:"var(--bg)",borderRadius:"0 6px 6px 0",border:"1px solid var(--border)",borderLeft:`3px solid ${accent}`,fontSize:13,lineHeight:1.65,color:"var(--text)"}}>{content}</div></div>;
}

// ── Config Audit Panel ────────────────────────────────────────────────────────
const HEALTH_COLOR = { critical:"var(--red)", warning:"var(--yellow)", info:"var(--blue)", ok:"var(--green)" };
const HEALTH_ICON  = { critical:"✕", warning:"⚠", info:"ℹ", ok:"✓" };
const ISSUE_COLOR  = { critical:"var(--red)", warning:"var(--yellow)", info:"var(--blue)" };
const ALL_ISSUE_META = {
  NO_ALARM_ACTION:{title:"No alarm action configured",description:"This alarm fires silently — no SNS notification when the metric breaches threshold.",fix:`aws cloudwatch put-metric-alarm \\\n  --alarm-name <alarm-name> \\\n  --alarm-actions arn:aws:sns:<region>:<account>:<topic>`},
  NO_OK_ACTION:{title:"No OK action — recovery goes unnoticed",description:"Without an OK action, on-call never knows the issue cleared.",fix:`# Add to your existing put-metric-alarm call:\n  --ok-actions arn:aws:sns:<region>:<account>:<topic>`},
  INSUFFICIENT_DATA:{title:"Alarm stuck in INSUFFICIENT_DATA",description:"CloudWatch isn't receiving metric data. The alarm cannot fire.",fix:`aws cloudwatch get-metric-statistics \\\n  --namespace <ns> --metric-name <metric> \\\n  --start-time $(date -u -d '1 hour ago' +%FT%TZ) \\\n  --end-time $(date -u +%FT%TZ) --period 300 --statistics Sum`},
  MISSING_DATA_IGNORED:{title:"Missing data treated as not breaching",description:"Gaps in the metric are silently ignored.",fix:`--treat-missing-data breaching`},
  SINGLE_PERIOD_EVAL:{title:"Only 1 evaluation period — noisy alerts",description:"A single transient spike will immediately trigger this alarm.",fix:`--evaluation-periods 2 \\\n--datapoints-to-alarm 2`},
  STUCK_IN_ALARM:{title:"Alarm stuck in ALARM state",description:"May indicate threshold misconfiguration or an unaddressed incident.",fix:null},
  RULE_PAUSED:{title:"Alert rule is paused",description:"This rule is disabled and will never fire.",fix:`curl -X PATCH https://<grafana>/api/v1/provisioning/alert-rules/<uid> \\\n  -H 'Authorization: Bearer <token>' \\\n  -d '{"isPaused": false}'`},
  NO_ROUTING:{title:"No labels — alert may not be routed",description:"This rule has no labels and there is no default receiver.",fix:`labels:\n  team: platform\n  severity: critical`},
  NO_RUNBOOK:{title:"No runbook URL annotation",description:"Responders have no documented procedure when this alert fires.",fix:`# Add to rule annotations:\nrunbook_url: https://wiki.example.com/runbooks/my-alert`},
  NO_DESCRIPTION:{title:"No summary or description annotation",description:"Alert messages will be cryptic.",fix:`summary: "{{ $labels.instance }} is down"\ndescription: "Service {{ $labels.job }} has been unreachable for > 5m"`},
  NO_NOTIFICATION:{title:"No notification recipients",description:"Monitor message has no @mentions — alerts fire silently.",fix:`# Add to monitor message:\n@your-slack-channel @on-call-engineer`},
  MONITOR_MUTED:{title:"Monitor is muted / silenced",description:"No alerts will fire from this monitor while it is silenced.",fix:`# Unmute in Datadog UI: Monitors → Manage → Unmute`},
  NO_DATA_UNCONFIGURED:{title:"No Data state with no policy",description:"Monitor is in No Data state and no no_data_timeframe policy is set.",fix:`"no_data_timeframe": 10`},
  NO_TAGS:{title:"Monitor has no tags",description:"Hard to filter and find during incident response.",fix:`# Add tags like: team:platform, service:api, env:prod`},
  NO_RENOTIFY:{title:"No renotification interval set",description:"Responders receive one alert then silence.",fix:`"renotify_interval": 30`},
  SERVICE_DISABLED:{title:"Service is disabled",description:"This service will not create incidents.",fix:`# Re-enable in PagerDuty UI: Services → … → Enable service`},
  NO_ESCALATION_POLICY:{title:"No escalation policy assigned",description:"Incidents created by this service will not be routed to anyone.",fix:`# Services → <service> → Settings → Assign escalation policy`},
  EMPTY_ESCALATION_POLICY:{title:"Escalation policy has no rules",description:"The assigned policy exists but has no escalation rules.",fix:`# Escalation Policies → <policy> → Add escalation rule`},
  NO_ONCALL_TARGETS:{title:"Escalation rules have no targets",description:"All escalation rules have empty target lists — no one will be paged.",fix:`# Add on-call schedules or users as targets to each rule`},
  NO_INTEGRATIONS:{title:"Service has no integrations",description:"This service cannot receive alerts from monitoring tools.",fix:`# Services → <service> → Integrations → Add integration`},
  SERVICE_WARNING:{title:"Service has open low-urgency incidents",description:"Low-urgency incidents are open — verify they are being tracked.",fix:null},
};

function IssueCard({ issue }) {
  const [showFix,setShowFix]=useState(false);
  const meta=ALL_ISSUE_META[issue.code]||{title:issue.message||issue.code,description:null,fix:null};
  const color=ISSUE_COLOR[issue.severity]||"var(--muted)";
  const badgeBg=issue.severity==="critical"?"rgba(220,38,38,0.1)":issue.severity==="warning"?"rgba(180,83,9,0.1)":"rgba(37,99,235,0.1)";
  const badgeBdr=issue.severity==="critical"?"rgba(220,38,38,0.3)":issue.severity==="warning"?"rgba(180,83,9,0.3)":"rgba(37,99,235,0.3)";
  return (
    <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:7,padding:"11px 13px",display:"grid",gridTemplateColumns:"8px 1fr auto",columnGap:10,alignItems:"start"}}>
      <div style={{width:7,height:7,borderRadius:"50%",background:color,marginTop:5,flexShrink:0}}/>
      <div>
        <div style={{fontSize:13,fontWeight:600,color:"var(--text)",marginBottom:meta.description?3:0,lineHeight:1.4}}>{meta.title}</div>
        {meta.description&&<div style={{fontSize:12,color:"var(--text-dim)",lineHeight:1.55}}>{meta.description}</div>}
        {meta.fix&&(<><button onClick={()=>setShowFix(v=>!v)} style={{marginTop:7,background:"none",border:"none",padding:0,fontFamily:"var(--font-mono)",fontSize:11,color:"var(--blue)",cursor:"pointer"}}>{showFix?"Hide fix ↑":"Show fix ↓"}</button>{showFix&&(<div style={{marginTop:7,background:"var(--bg)",border:"1px solid var(--border)",borderRadius:5,padding:"9px 11px"}}><div style={{fontFamily:"var(--font-mono)",fontSize:9,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>Fix</div><pre style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--blue)",lineHeight:1.7,whiteSpace:"pre-wrap",wordBreak:"break-all",margin:0}}>{meta.fix}</pre></div>)}</>)}
      </div>
      <span style={{fontFamily:"var(--font-mono)",fontSize:10,fontWeight:600,padding:"2px 7px",borderRadius:99,background:badgeBg,border:`1px solid ${badgeBdr}`,color,whiteSpace:"nowrap",marginTop:1}}>{issue.severity}</span>
    </div>
  );
}

function GenericItemCard({ item }) {
  const [open,setOpen]=useState(false);
  const hColor=HEALTH_COLOR[item.health]||"var(--muted)"; const hIcon=HEALTH_ICON[item.health]||"?";
  const meta=[];
  if(item.type) meta.push(["Type",item.type]); if(item.state) meta.push(["State",item.state]); if(item.status) meta.push(["Status",item.status]);
  if(item.escalation_policy) meta.push(["Escalation",item.escalation_policy]); if(item.integrations_count!=null) meta.push(["Integrations",String(item.integrations_count)]);
  if(item.folder) meta.push(["Folder",item.folder]); if(item.tags?.length) meta.push(["Tags",item.tags.join(", ")]);
  return (
    <div style={{border:"1px solid var(--border)",borderLeft:`3px solid ${hColor}`,borderRadius:"0 7px 7px 0",overflow:"hidden",background:"var(--bg)"}}>
      <div onClick={()=>setOpen(o=>!o)} style={{padding:"10px 14px",display:"flex",alignItems:"center",gap:10,cursor:"pointer",userSelect:"none"}}>
        <span style={{fontFamily:"var(--font-mono)",fontSize:11,fontWeight:700,color:hColor,width:14,textAlign:"center",flexShrink:0}}>{hIcon}</span>
        <span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name}</span>
        {item.issues_count>0&&<span style={{fontFamily:"var(--font-mono)",fontSize:10,color:hColor,flexShrink:0}}>{item.issues_count} issue{item.issues_count!==1?"s":""}</span>}
        <span style={{color:"var(--muted)",fontSize:10,flexShrink:0}}>{open?"▲":"▼"}</span>
      </div>
      {open&&(<div style={{padding:"0 14px 14px",borderTop:"1px solid var(--border)"}}>
        {item.issues?.length>0&&<div style={{marginTop:12}}><AuditLabel>Issues &amp; fixes</AuditLabel><div style={{display:"flex",flexDirection:"column",gap:7}}>{item.issues.map((issue,i)=><IssueCard key={i} issue={issue}/>)}</div></div>}
        {meta.length>0&&<div style={{marginTop:12}}><AuditLabel>Configuration</AuditLabel><div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:5}}>{meta.map(([k,v])=><div key={k} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:5,padding:"7px 9px"}}><div style={{fontFamily:"var(--font-mono)",fontSize:9,color:"var(--muted)",textTransform:"uppercase",letterSpacing:0.8,marginBottom:3}}>{k}</div><div style={{fontFamily:"var(--font-mono)",fontSize:11,fontWeight:600,color:"var(--text-dim)",wordBreak:"break-all",lineHeight:1.4}}>{v}</div></div>)}</div></div>}
        {item.url&&<div style={{marginTop:10}}><a href={item.url} target="_blank" rel="noreferrer" style={{fontFamily:"var(--font-mono)",fontSize:10,color:"var(--blue)",textDecoration:"none"}}>↗ Open in console</a></div>}
      </div>)}
    </div>
  );
}

function AlarmCard({ alarm, isExpanded, onToggle }) {
  const hColor=HEALTH_COLOR[alarm.health]||"var(--muted)"; const hIcon=HEALTH_ICON[alarm.health]||"?";
  const configRows=alarm.type==="metric"&&alarm.metric?[
    ["Namespace",alarm.metric.namespace,false],["Metric",alarm.metric.name,false],["Statistic",alarm.metric.statistic,false],
    ["Period",alarm.metric.period_seconds!=null?`${alarm.metric.period_seconds}s`:null,false],["Eval periods",alarm.metric.evaluation_periods,alarm.metric.evaluation_periods===1],
    ["DTP alarm",alarm.metric.datapoints_to_alarm??"—",false],["Threshold",alarm.metric.threshold!=null?`${alarm.metric.comparison_operator} ${alarm.metric.threshold}`:null,false],
    ["Missing data",alarm.metric.treat_missing_data,alarm.metric.treat_missing_data==="missing"],["Unit",alarm.metric.unit||"—",false],
    ...(alarm.metric.dimensions?.length>0?[["Dimensions",alarm.metric.dimensions.map(d=>`${d.name}=${d.value}`).join(", "),false]]:[]),
  ].filter(([,v])=>v!=null&&v!==""):[];
  return (
    <div style={{border:"1px solid var(--border)",borderLeft:`3px solid ${hColor}`,borderRadius:"0 7px 7px 0",overflow:"hidden",background:"var(--bg)"}}>
      <div onClick={onToggle} style={{padding:"10px 14px",display:"flex",alignItems:"center",gap:10,cursor:"pointer",userSelect:"none"}}>
        <span style={{fontFamily:"var(--font-mono)",fontSize:11,fontWeight:700,color:hColor,width:14,textAlign:"center",flexShrink:0}}>{hIcon}</span>
        <span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{alarm.name}</span>
        <span style={{fontFamily:"var(--font-mono)",fontSize:10,padding:"2px 7px",borderRadius:4,background:alarm.state==="ALARM"?"rgba(220,38,38,0.1)":alarm.state==="OK"?"rgba(5,150,105,0.1)":"rgba(107,114,128,0.1)",color:alarm.state==="ALARM"?"var(--red)":alarm.state==="OK"?"var(--green)":"var(--muted)",border:`1px solid ${alarm.state==="ALARM"?"rgba(220,38,38,0.3)":alarm.state==="OK"?"rgba(5,150,105,0.25)":"var(--border)"}`,flexShrink:0}}>{alarm.state}</span>
        {alarm.issues_count>0&&<span style={{fontFamily:"var(--font-mono)",fontSize:10,color:hColor,flexShrink:0}}>{alarm.issues_count} issue{alarm.issues_count!==1?"s":""}</span>}
        <span style={{color:"var(--muted)",fontSize:10,flexShrink:0}}>{isExpanded?"▲":"▼"}</span>
      </div>
      {isExpanded&&(<div style={{padding:"0 14px 16px",borderTop:"1px solid var(--border)"}}>
        {alarm.issues?.length>0&&<div style={{marginTop:14}}><AuditLabel>Issues &amp; fixes</AuditLabel><div style={{display:"flex",flexDirection:"column",gap:8}}>{alarm.issues.map((issue,i)=><IssueCard key={i} issue={issue}/>)}</div></div>}
        {configRows.length>0&&<div style={{marginTop:14}}><AuditLabel>Current configuration</AuditLabel><div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:6}}>{configRows.map(([k,v,isBad])=><div key={k} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:5,padding:"8px 10px"}}><div style={{fontFamily:"var(--font-mono)",fontSize:9,color:"var(--muted)",textTransform:"uppercase",letterSpacing:0.8,marginBottom:3}}>{k}</div><div style={{fontFamily:"var(--font-mono)",fontSize:11,fontWeight:600,color:isBad?"var(--yellow)":"var(--text-dim)",wordBreak:"break-all",lineHeight:1.4}}>{String(v)}</div></div>)}</div></div>}
        {alarm.type==="composite"&&alarm.rule&&<div style={{marginTop:14}}><AuditLabel>Composite rule</AuditLabel><div style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-dim)",background:"var(--surface)",padding:"8px 10px",borderRadius:5,border:"1px solid var(--border)",wordBreak:"break-all",lineHeight:1.6}}>{alarm.rule}</div></div>}
        <div style={{marginTop:14}}><AuditLabel>Notification actions</AuditLabel><div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:6}}>{[["ALARM",alarm.actions?.alarm],["OK",alarm.actions?.ok],["INSUF",alarm.actions?.insufficient_data]].map(([label,actions])=>{const hasActions=actions?.length>0;return<div key={label} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:5,padding:"8px 10px"}}><div style={{fontFamily:"var(--font-mono)",fontSize:9,color:"var(--muted)",textTransform:"uppercase",letterSpacing:0.8,marginBottom:3}}>{label}</div><div style={{fontFamily:"var(--font-mono)",fontSize:11,fontWeight:600,color:hasActions?"var(--text-dim)":"var(--red)",wordBreak:"break-all",lineHeight:1.4}}>{hasActions?"configured":"none"}</div></div>;})}</div></div>
        {alarm.url&&<div style={{marginTop:12}}><a href={alarm.url} target="_blank" rel="noreferrer" style={{fontFamily:"var(--font-mono)",fontSize:10,color:"var(--blue)",textDecoration:"none"}}>↗ Open in AWS Console</a></div>}
      </div>)}
    </div>
  );
}

const SOURCE_DISPLAY = { cloudwatch:{label:"CloudWatch Alarms",color:"#ea580c",icon:"☁"}, grafana:{label:"Grafana Alert Rules",color:"#ca8a04",icon:"◈"}, datadog:{label:"Datadog Monitors",color:"#2563eb",icon:"⬡"}, pagerduty:{label:"PagerDuty Services",color:"#dc2626",icon:"🚨"} };

function SummaryChip({ value, color, label }) {
  return <span style={{fontFamily:"var(--font-mono)",fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:99,background:color+"18",color}}>{value} {label}</span>;
}

function SourceSection({ sourceKey, sourceData }) {
  const [collapsed,setCollapsed]=useState(false);
  const [expandedItem,setExpandedItem]=useState(null);
  const meta=SOURCE_DISPLAY[sourceKey]||{label:sourceKey,color:"var(--muted)",icon:"●"};
  const items=sourceData?.items||[]; const summary=sourceData?.summary||{};
  if(sourceData?.error){return<div style={{border:"1px solid var(--border)",borderRadius:7,overflow:"hidden"}}><div style={{padding:"10px 14px",background:"var(--bg)",display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:12}}>{meta.icon}</span><span style={{fontFamily:"var(--font-mono)",fontSize:12,fontWeight:600,color:meta.color}}>{meta.label}</span><span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--red)",marginLeft:"auto"}}>⚠ {sourceData.error.slice(0,80)}</span></div></div>;}
  if(!sourceData?.configured) return null;
  const toggle=(id)=>setExpandedItem(prev=>prev===id?null:id);
  return (
    <div style={{border:"1px solid var(--border)",borderRadius:8,overflow:"hidden"}}>
      <div onClick={()=>setCollapsed(c=>!c)} style={{padding:"10px 14px",background:"var(--surface2)",display:"flex",alignItems:"center",gap:10,cursor:"pointer",borderBottom:collapsed?"none":"1px solid var(--border)"}}>
        <span style={{fontSize:13}}>{meta.icon}</span>
        <span style={{fontFamily:"var(--font-mono)",fontSize:12,fontWeight:700,color:meta.color}}>{meta.label}</span>
        <div style={{display:"flex",gap:6,marginLeft:8}}>
          {summary.critical>0&&<SummaryChip value={summary.critical} color="var(--red)" label="crit"/>}
          {summary.warning>0&&<SummaryChip value={summary.warning} color="var(--yellow)" label="warn"/>}
          {summary.info>0&&<SummaryChip value={summary.info} color="var(--blue)" label="info"/>}
          {summary.ok>0&&<SummaryChip value={summary.ok} color="var(--green)" label="ok"/>}
        </div>
        <span style={{color:"var(--muted)",fontSize:11,marginLeft:"auto",fontFamily:"var(--font-mono)"}}>{items.length} item{items.length!==1?"s":""} {collapsed?"▼":"▲"}</span>
      </div>
      {!collapsed&&(<div style={{padding:"10px 14px 14px",display:"flex",flexDirection:"column",gap:7,background:"var(--bg)"}}>
        {items.length===0?<p style={{color:"var(--muted)",fontSize:12,textAlign:"center",padding:"16px 0"}}>No items found.</p>
        :sourceKey==="cloudwatch"?items.map(item=>{const alarm=item._alarm||item;return<AlarmCard key={alarm.name} alarm={alarm} isExpanded={expandedItem===alarm.name} onToggle={()=>toggle(alarm.name)}/>;})
        :items.map(item=><GenericItemCard key={item.id||item.uid||item.name} item={item}/>)}
      </div>)}
    </div>
  );
}

function ConfigAuditPanel({ data, loading, error, onClose, onRefresh }) {
  const sources=data?.sources||{}; const summary=data?.summary||{};
  const configuredSources=Object.entries(sources).filter(([,s])=>s?.configured!==false);
  return (
    <div style={{height:"100%",display:"flex",flexDirection:"column"}}>
      <div style={{padding:"13px 18px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:8,flexShrink:0,background:"var(--surface)"}}>
        <span style={{color:"var(--yellow)",fontSize:13}}>⚙</span>
        <span style={{fontFamily:"var(--font-mono)",fontSize:12,fontWeight:600,color:"var(--text)"}}>Config Audit</span>
        {data&&!loading&&<span style={{fontFamily:"var(--font-mono)",fontSize:10,color:"var(--muted)"}}>— {configuredSources.length} source{configuredSources.length!==1?"s":""}</span>}
        <button onClick={onRefresh} title="Re-run audit" style={{marginLeft:"auto",background:"none",border:"none",color:"var(--muted)",fontSize:13,cursor:"pointer",fontFamily:"var(--font-mono)"}}>↺</button>
        <button onClick={onClose} style={{background:"none",border:"none",color:"var(--muted)",fontSize:18,cursor:"pointer",lineHeight:1}}>×</button>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 18px 32px"}}>
        {loading&&<div style={{textAlign:"center",paddingTop:60}}><Spinner size={28} color="var(--yellow)"/><p style={{color:"var(--muted)",marginTop:20,fontSize:13}}>Auditing all connected integrations…</p></div>}
        {error&&!loading&&(<div style={{display:"flex",flexDirection:"column",gap:12}}><ErrorBanner error={error}/><button onClick={onRefresh} style={{...btnStyle,alignSelf:"flex-start"}}>↺ Retry</button></div>)}
        {data&&!loading&&(<div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {[{label:"total",value:summary.total,color:"var(--text-dim)"},{label:"critical",value:summary.critical,color:"var(--red)"},{label:"warning",value:summary.warning,color:"var(--yellow)"},{label:"info",value:summary.info,color:"var(--blue)"},{label:"ok",value:summary.ok,color:"var(--green)"}].filter(({label,value})=>value>0||label==="total").map(({label,value,color})=>(
              <div key={label} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:99,fontFamily:"var(--font-mono)"}}>
                <span style={{fontSize:15,fontWeight:700,color}}>{value}</span>
                <span style={{fontSize:10,color:"var(--muted)",textTransform:"uppercase",letterSpacing:0.5}}>{label}</span>
              </div>
            ))}
          </div>
          {["cloudwatch","grafana","datadog","pagerduty"].map(key=>sources[key]?<SourceSection key={key} sourceKey={key} sourceData={sources[key]}/>:null)}
          {configuredSources.length===0&&<p style={{color:"var(--muted)",fontSize:13,textAlign:"center",paddingTop:24}}>No configured sources returned audit data.</p>}
        </div>)}
      </div>
    </div>
  );
}

function AuditLabel({ children }) { return <div style={{fontFamily:"var(--font-mono)",fontSize:9,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:7}}>{children}</div>; }
