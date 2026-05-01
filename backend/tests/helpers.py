"""Shared test utilities imported by conftest.py and test modules."""
from main import AIProvider


class FakeAIProvider(AIProvider):
    """Stub provider — returns a fixed string, makes no network calls."""

    def __init__(self, response: str):
        self._response = response

    @property
    def name(self) -> str:
        return "fake"

    async def complete(self, system_prompt: str, user_message: str) -> str:
        return self._response
