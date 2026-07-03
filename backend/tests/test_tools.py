from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from backend.app.tools.adapters import FileAdapter
from backend.app.tools.models import ToolError
from backend.app.tools.registry import create_default_registry


class FakeDesktop:
    def __init__(self) -> None:
        self.opened: list[str] = []
        self.clipboard = ""

    def current_time(self) -> str:
        return "2026-07-03T12:00:00+08:00"

    def system_info(self) -> dict[str, str]:
        return {"operating_system": "Windows", "release": "test", "architecture": "x64", "python": "3.12"}

    def open_url(self, url: str) -> str:
        self.opened.append(url)
        return "opened"

    def open_app(self, application: str) -> str:
        self.opened.append(application)
        return "opened"

    def read_clipboard(self) -> str:
        return self.clipboard

    def write_clipboard(self, text: str) -> str:
        self.clipboard = text
        return "updated"


def test_registry_exposes_only_l0_to_l2_and_validates_arguments(tmp_path: Path) -> None:
    registry = create_default_registry(tmp_path, desktop=FakeDesktop())
    names = {item["function"]["name"] for item in registry.definitions()}
    assert names == {
        "system.current_time",
        "system.info",
        "desktop.open_url",
        "desktop.open_app",
        "clipboard.read_text",
        "clipboard.write_text",
        "files.search_names",
        "files.read_text",
    }
    assert all(registry.descriptor(name).risk_level != "L3" for name in names)

    with pytest.raises(ToolError, match="not available"):
        registry.descriptor("system.run_command")
    with pytest.raises(ToolError) as caught:
        asyncio.run(registry.execute("desktop.open_app", {"application": "powershell"}))
    assert caught.value.error_code == "TOOL_ARGUMENT_INVALID"


def test_file_adapter_search_and_read_boundaries(tmp_path: Path) -> None:
    adapter = FileAdapter(tmp_path)
    (tmp_path / "note.txt").write_text("hello", encoding="utf-8")
    (tmp_path / "ignored.exe").write_text("no", encoding="utf-8")
    assert adapter.search_names("note") == ["note.txt"]
    assert adapter.read_text("note.txt") == "hello"

    with pytest.raises(ToolError) as caught:
        adapter.read_text("../secret.txt")
    assert caught.value.error_code == "TOOL_PATH_FORBIDDEN"
    with pytest.raises(ToolError) as caught:
        adapter.read_text("ignored.exe")
    assert caught.value.error_code == "TOOL_FILE_TYPE_FORBIDDEN"

    large = tmp_path / "large.txt"
    large.write_bytes(b"x" * (64 * 1024 + 1))
    with pytest.raises(ToolError) as caught:
        adapter.read_text("large.txt")
    assert caught.value.error_code == "TOOL_FILE_TOO_LARGE"


def test_registry_executes_with_injected_desktop_without_real_side_effects(tmp_path: Path) -> None:
    desktop = FakeDesktop()
    registry = create_default_registry(tmp_path, desktop=desktop)
    result = asyncio.run(registry.execute("clipboard.write_text", {"text": "safe"}))
    assert result.status == "succeeded"
    assert desktop.clipboard == "safe"