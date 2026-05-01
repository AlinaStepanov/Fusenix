"""
Unit tests for GitHubConnector helper methods.

No GitHub token or network access needed — these test pure parsing logic.
"""
import pytest
from connectors.github import GitHubConnector


@pytest.fixture
def gh():
    return GitHubConnector(token=None, repos=[])


class TestSplitRepo:
    """_split_repo parses 'owner/repo' strings into (owner, name) tuples."""

    def test_standard_owner_repo(self, gh):
        owner, name = gh._split_repo("myorg/myrepo")
        assert owner == "myorg"
        assert name == "myrepo"

    def test_handles_hyphens_and_dots(self, gh):
        owner, name = gh._split_repo("my-org/my.repo")
        assert owner == "my-org"
        assert name == "my.repo"

    def test_missing_slash_returns_empty_owner(self, gh):
        owner, name = gh._split_repo("badformat")
        assert owner == ""

    def test_empty_string_returns_empty_pair(self, gh):
        owner, name = gh._split_repo("")
        assert owner == ""
        assert name == ""

    def test_leading_trailing_whitespace_stripped(self, gh):
        owner, name = gh._split_repo("  myorg/myrepo  ")
        assert owner == "myorg"
        assert name == "myrepo"


class TestNormTs:
    """_norm_ts normalises Z-suffix timestamps to +00:00 for fromisoformat()."""

    def test_z_suffix_converted(self, gh):
        result = gh._norm_ts("2026-04-25T14:31:00Z")
        assert result == "2026-04-25T14:31:00+00:00"

    def test_already_offset_unchanged(self, gh):
        ts = "2026-04-25T14:31:00+00:00"
        assert gh._norm_ts(ts) == ts

    def test_no_tz_info_unchanged(self, gh):
        ts = "2026-04-25T14:31:00"
        assert gh._norm_ts(ts) == ts
