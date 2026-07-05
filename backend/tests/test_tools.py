from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from backend.app.tools.adapters import FileAdapter, windows_marketing_release
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


def adapter(tmp_path: Path, **kwargs) -> FileAdapter:
    return FileAdapter(tmp_path / "shared", search_roots=[tmp_path], **kwargs)


def test_registry_exposes_safe_tools_and_write_operations_are_l2(tmp_path: Path) -> None:
    files = adapter(tmp_path)
    registry = create_default_registry(files.root, files=files, desktop=FakeDesktop())
    names = {item["function"]["name"] for item in registry.definitions()}
    assert names == {
        "system_current_time", "system_info", "desktop_open_url", "desktop_open_app",
        "clipboard_read_text", "clipboard_write_text", "files_search_names",
        "files_read_file", "files_create_text", "files_replace_text", "files_read_text",
    }
    for name in ("clipboard.write_text", "files.search_names", "files.read_file", "files.create_text", "files.replace_text"):
        assert registry.descriptor(name).risk_level == "L2"
    assert registry.canonical_name("files_read_file") == "files.read_file"

    with pytest.raises(ToolError, match="not available"):
        registry.descriptor("system.run_command")
    with pytest.raises(ToolError) as caught:
        asyncio.run(registry.execute("desktop.open_app", {"application": "powershell"}))
    assert caught.value.error_code == "TOOL_ARGUMENT_INVALID"


def test_search_returns_file_references_and_skips_sensitive_locations(tmp_path: Path) -> None:
    files = adapter(tmp_path)
    (tmp_path / "note.txt").write_text("hello", encoding="utf-8")
    sensitive = tmp_path / "AppData"
    sensitive.mkdir()
    (sensitive / "note-secret.txt").write_text("secret", encoding="utf-8")
    (tmp_path / ".env").write_text("key", encoding="utf-8")
    (tmp_path / "ignored.exe").write_text("no", encoding="utf-8")

    result = files.search_names("note")
    assert result["complete"] is True
    assert [item["name"] for item in result["results"]] == ["note.txt"]
    file_id = result["results"][0]["file_id"]
    assert files.read_file(file_id) == "hello"

    with pytest.raises(ToolError) as caught:
        files.read_file("forged")
    assert caught.value.error_code == "TOOL_FILE_REFERENCE_INVALID"


def test_shared_read_boundaries_remain_compatible(tmp_path: Path) -> None:
    files = adapter(tmp_path)
    (files.root / "note.txt").write_text("hello", encoding="utf-8")
    (files.root / "ignored.exe").write_text("no", encoding="utf-8")
    assert files.read_text("note.txt") == "hello"
    with pytest.raises(ToolError) as caught:
        files.read_text("../note.txt")
    assert caught.value.error_code == "TOOL_PATH_FORBIDDEN"


def test_create_and_replace_are_atomic_and_replacement_creates_backup(tmp_path: Path) -> None:
    files = adapter(tmp_path)
    target = tmp_path / "created.txt"
    files.create_text(str(target), "first")
    assert target.read_text(encoding="utf-8") == "first"
    with pytest.raises(ToolError) as caught:
        files.create_text(str(target), "overwrite")
    assert caught.value.error_code == "TOOL_FILE_EXISTS"

    file_id = files.search_names("created")["results"][0]["file_id"]
    details = files.replace_details(file_id, "second")
    assert details["target"].endswith("created.txt")
    assert details["content"] == "second"
    assert details["will_create_backup"] is True
    files.replace_text(file_id, "second")
    assert target.read_text(encoding="utf-8") == "second"
    backups = list(tmp_path.glob("created.txt.garfield-backup-*"))
    assert len(backups) == 1
    assert backups[0].read_text(encoding="utf-8") == "first"


def test_replace_rejects_file_changed_after_search(tmp_path: Path) -> None:
    files = adapter(tmp_path)
    target = tmp_path / "note.txt"
    target.write_text("first", encoding="utf-8")
    file_id = files.search_names("note")["results"][0]["file_id"]
    target.write_text("external change", encoding="utf-8")
    with pytest.raises(ToolError) as caught:
        files.replace_text(file_id, "agent change")
    assert caught.value.error_code == "TOOL_FILE_CHANGED"
    assert target.read_text(encoding="utf-8") == "external change"
    assert not list(tmp_path.glob("*.garfield-backup-*"))


def test_registry_executes_with_injected_desktop_without_real_side_effects(tmp_path: Path) -> None:
    desktop = FakeDesktop()
    files = adapter(tmp_path)
    registry = create_default_registry(files.root, files=files, desktop=desktop)
    details = registry.confirmation_details("clipboard.write_text", {"text": "safe"})
    assert details == {
        "target": "\u526a\u8d34\u677f", "operation": "clipboard", "content": "safe",
        "content_length": 4, "will_create_backup": False,
    }
    result = asyncio.run(registry.execute("clipboard.write_text", {"text": "safe"}))
    assert result.status == "succeeded"
    assert desktop.clipboard == "safe"


def test_filename_search_does_not_open_file_contents(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    files = adapter(tmp_path)
    target = tmp_path / "opaque-note.txt"
    target.write_text("content must remain unread", encoding="utf-8")
    original_open = Path.open

    def guarded_open(path: Path, *args, **kwargs):
        if path == target:
            raise AssertionError("filename search opened file content")
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", guarded_open)
    result = files.search_names("opaque-note")
    assert [item["name"] for item in result["results"]] == ["opaque-note.txt"]

def test_exact_absolute_path_resolves_without_directory_scan(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    files = adapter(tmp_path)
    target = tmp_path / "exact.txt"
    target.write_text("exact contents", encoding="utf-8")

    def fail_scandir(_path):
        raise AssertionError("exact path resolution must not scan directories")

    monkeypatch.setattr("backend.app.tools.adapters.os.scandir", fail_scandir)
    result = files.search_names(str(target))
    assert result["complete"] is True
    assert result["results"][0]["path"].endswith("exact.txt")
    assert files.read_file(result["results"][0]["file_id"]) == "exact contents"


def test_exact_filename_match_returns_before_full_scan(tmp_path: Path) -> None:
    files = adapter(tmp_path)
    (tmp_path / "test1.txt").write_text("hello", encoding="utf-8")
    result = files.search_names("test1.txt")
    assert result["results"][0]["name"] == "test1.txt"
    assert result["stopped_reason"] == "exact_match"

def test_windows_marketing_release_uses_build_number() -> None:
    assert windows_marketing_release(26100, "10") == "11"
    assert windows_marketing_release(22621, "10") == "11"
    assert windows_marketing_release(19045, "10") == "10"
    assert windows_marketing_release(26100, "Server", product_type=3) == "Server"


def test_confirmation_summaries_are_chinese(tmp_path: Path) -> None:
    files = adapter(tmp_path)
    registry = create_default_registry(files.root, files=files, desktop=FakeDesktop())
    assert registry.confirmation_summary("clipboard.write_text", {"text": "safe"}) == "\u5199\u5165\u526a\u8d34\u677f"
    assert "\u641c\u7d22\u6587\u4ef6\u540d" in registry.confirmation_summary("files.search_names", {"query": "note", "max_results": 20})
    assert registry.confirmation_details("files.search_names", {"query": "note", "max_results": 20})["target"] == "\u672c\u5730\u56fa\u5b9a\u78c1\u76d8\u7684\u975e\u654f\u611f\u533a\u57df"