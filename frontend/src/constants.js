export const SOURCE_META = {
  cloudwatch: { label: "CloudWatch",  color: "#ea580c", icon: "☁",  group: "aws" },
  grafana:    { label: "Grafana",     color: "#ca8a04", icon: "◈",  group: "observability" },
  datadog:    { label: "Datadog",     color: "#2563eb", icon: "⬡",  group: "observability" },
  pagerduty:  { label: "PagerDuty",   color: "#dc2626", icon: "🚨", group: "alerting" },
  github:     { label: "GitHub",      color: "#7c3aed", icon: "◉",  group: "vcs" },
  cicd:       { label: "CI/CD",       color: "#059669", icon: "⚙",  group: "deploy" },
};

export const SEVERITY = {
  critical: { color: "#dc2626", label: "CRIT" },
  warning:  { color: "#b45309", label: "WARN" },
  info:     { color: "#2563eb", label: "INFO" },
  success:  { color: "#059669", label: "OK"   },
};

export const ALL_SOURCES = Object.keys(SOURCE_META);
