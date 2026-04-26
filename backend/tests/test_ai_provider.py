"""
Unit tests for get_ai_provider() provider-selection logic.

Each test sets env vars via monkeypatch (scoped to the test — auto-reverted)
then calls get_ai_provider() and asserts the correct class is returned.
No network calls are made.
"""
import pytest
from fastapi import HTTPException

from main import (
    get_ai_provider,
    AnthropicProvider,
    AzureOpenAIProvider,
    OpenAICompatibleProvider,
)


class TestProviderSelection:
    def test_anthropic(self, monkeypatch):
        monkeypatch.setenv("AI_PROVIDER", "anthropic")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        provider = get_ai_provider()
        assert isinstance(provider, AnthropicProvider)
        assert provider.name == "anthropic"

    def test_openai(self, monkeypatch):
        monkeypatch.setenv("AI_PROVIDER", "openai")
        monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-test")
        provider = get_ai_provider()
        assert isinstance(provider, OpenAICompatibleProvider)
        assert provider.name == "openai"

    def test_openrouter(self, monkeypatch):
        monkeypatch.setenv("AI_PROVIDER", "openrouter")
        monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
        provider = get_ai_provider()
        assert isinstance(provider, OpenAICompatibleProvider)
        assert provider.name == "openrouter"

    def test_groq(self, monkeypatch):
        monkeypatch.setenv("AI_PROVIDER", "groq")
        monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
        provider = get_ai_provider()
        assert isinstance(provider, OpenAICompatibleProvider)
        assert provider.name == "groq"

    def test_ollama_needs_no_key(self, monkeypatch):
        # Ollama runs locally and doesn't require an API key
        monkeypatch.setenv("AI_PROVIDER", "ollama")
        monkeypatch.delenv("AI_API_KEY", raising=False)
        provider = get_ai_provider()
        assert isinstance(provider, OpenAICompatibleProvider)
        assert provider.name == "ollama"

    def test_azure_openai(self, monkeypatch):
        monkeypatch.setenv("AI_PROVIDER", "azure_openai")
        monkeypatch.setenv("AZURE_OPENAI_API_KEY", "az-test-key")
        monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://myresource.openai.azure.com")
        provider = get_ai_provider()
        assert isinstance(provider, AzureOpenAIProvider)
        assert provider.name == "azure_openai"

    def test_custom_provider_via_base_url(self, monkeypatch):
        monkeypatch.setenv("AI_PROVIDER", "lmstudio")
        monkeypatch.setenv("AI_BASE_URL", "http://localhost:1234/v1")
        monkeypatch.setenv("AI_API_KEY", "lm-local")
        monkeypatch.setenv("AI_MODEL", "phi-3")
        provider = get_ai_provider()
        assert isinstance(provider, OpenAICompatibleProvider)


class TestProviderMisconfig:
    def test_anthropic_missing_key_raises_500(self, monkeypatch):
        monkeypatch.setenv("AI_PROVIDER", "anthropic")
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.delenv("AI_API_KEY", raising=False)
        with pytest.raises(HTTPException) as exc:
            get_ai_provider()
        assert exc.value.status_code == 500

    def test_azure_missing_endpoint_raises_500(self, monkeypatch):
        monkeypatch.setenv("AI_PROVIDER", "azure_openai")
        monkeypatch.setenv("AZURE_OPENAI_API_KEY", "az-key")
        monkeypatch.delenv("AZURE_OPENAI_ENDPOINT", raising=False)
        with pytest.raises(HTTPException) as exc:
            get_ai_provider()
        assert exc.value.status_code == 500

    def test_unknown_provider_no_base_url_raises_500(self, monkeypatch):
        monkeypatch.setenv("AI_PROVIDER", "nonexistent-llm")
        monkeypatch.delenv("AI_BASE_URL", raising=False)
        with pytest.raises(HTTPException) as exc:
            get_ai_provider()
        assert exc.value.status_code == 500
        assert "nonexistent-llm" in exc.value.detail

    def test_openai_missing_key_raises_500(self, monkeypatch):
        monkeypatch.setenv("AI_PROVIDER", "openai")
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.delenv("AI_API_KEY", raising=False)
        with pytest.raises(HTTPException) as exc:
            get_ai_provider()
        assert exc.value.status_code == 500
