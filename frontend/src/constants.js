export const SOURCE_META = {
  cloudwatch: { label: "CloudWatch",  color: "#fb923c", icon: "☁",  group: "aws" },
  grafana:    { label: "Grafana",     color: "#f5c842", icon: "◈",  group: "observability" },
  datadog:    { label: "Datadog",     color: "#4d9fff", icon: "⬡",  group: "observability" },
  pagerduty:  { label: "PagerDuty",   color: "#ff4d6a", icon: "🚨", group: "alerting" },
  github:     { label: "GitHub",      color: "#a78bfa", icon: "◉",  group: "vcs" },
  cicd:       { label: "CI/CD",       color: "#00e5a0", icon: "⚙",  group: "deploy" },
};

export const SEVERITY = {
  critical: { color: "#ff4d6a", label: "CRIT" },
  warning:  { color: "#f5c842", label: "WARN" },
  info:     { color: "#4d9fff", label: "INFO" },
  success:  { color: "#00e5a0", label: "OK"   },
};

export const ALL_SOURCES = Object.keys(SOURCE_META);