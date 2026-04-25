# ════════════════════════════════════════════════════════════════════════════
# OpsBridge — AI Provider Configuration (.env.pro)
#
# This file controls WHICH AI provider the /analyze endpoint uses.
# It is loaded AFTER .env, so values here override anything in .env.
#
# Copy this file and fill in the credentials for the provider you want.
# ⚠️  Never commit real API keys — .env.pro is git-ignored.
# ════════════════════════════════════════════════════════════════════════════

# ── Provider selection ────────────────────────────────────────────────────────
# Choose one of:
#   openrouter | openai | anthropic | ollama | azure_openai
#   groq | together | mistral | (any OpenAI-compatible service via AI_BASE_URL)
AI_PROVIDER=openrouter

# ── Universal settings (apply to all OpenAI-compatible providers) ─────────────
# These are the fallback values. Provider-specific vars below take priority.
AI_API_KEY=
AI_MODEL=

# Override the base URL for custom / self-hosted OpenAI-compatible endpoints.
# Leave blank to use the built-in default for the selected AI_PROVIDER.
AI_BASE_URL=

# ════════════════════════════════════════════════════════════════════════════
# Provider-specific settings
# Only the block matching your AI_PROVIDER is used; the rest are ignored.
# ════════════════════════════════════════════════════════════════════════════

# ── OpenRouter ────────────────────────────────────────────────────────────────
# Sign up at https://openrouter.ai — supports 200+ models via one key.
# Default model "openrouter/auto" picks the best available free model.
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
OPENROUTER_MODEL=openrouter/auto
# Other popular choices: openai/gpt-4o-mini  mistralai/mistral-7b-instruct

# ── OpenAI ────────────────────────────────────────────────────────────────────
# https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_MODEL=gpt-4o-mini

# ── Anthropic (Claude) ────────────────────────────────────────────────────────
# https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
# Other choices: claude-sonnet-4-6  claude-opus-4-6

# ── Ollama (local, no key required) ───────────────────────────────────────────
# Run `ollama serve` and pull a model: ollama pull llama3
# AI_BASE_URL is set automatically to http://localhost:11434/v1
# Override if Ollama runs on a different host:
# AI_BASE_URL=http://192.168.1.50:11434/v1
# AI_MODEL=llama3

# ── Azure OpenAI ──────────────────────────────────────────────────────────────
# https://portal.azure.com → your Azure OpenAI resource
AZURE_OPENAI_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4o
AZURE_OPENAI_API_VERSION=2024-02-01

# ── Groq (ultra-fast inference) ───────────────────────────────────────────────
# https://console.groq.com/keys
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GROQ_MODEL=llama3-8b-8192

# ── Together AI ───────────────────────────────────────────────────────────────
TOGETHER_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TOGETHER_MODEL=mistralai/Mixtral-8x7B-Instruct-v0.1

# ── Mistral AI ────────────────────────────────────────────────────────────────
MISTRAL_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
MISTRAL_MODEL=mistral-small-latest

# ── Custom / unlisted OpenAI-compatible provider ──────────────────────────────
# Set AI_PROVIDER to any name, provide the base URL and key:
# AI_PROVIDER=my_provider
# AI_BASE_URL=https://api.my-llm-provider.com/v1
# AI_API_KEY=my-secret-key
# AI_MODEL=my-model-name
