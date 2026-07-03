from __future__ import annotations

import ctypes
import os
import platform
import stat
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from backend.app.tools.models import ToolError

TEXT_EXTENSIONS = {".txt", ".md", ".json", ".csv", ".log"}
MAX_FILE_BYTES = 64 * 1024
MAX_CLIPBOARD_CHARS = 10_000


class FileAdapter:
    def __init__(self, root: Path) -> None:
        self.root = root.expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _is_reparse_point(path: Path) -> bool:
        if not path.exists():
            return False
        attributes = getattr(path.lstat(), "st_file_attributes", 0)
        return bool(attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0))

    def _safe_path(self, relative_path: str, *, must_exist: bool) -> Path:
        candidate = Path(relative_path)
        if candidate.is_absolute() or not relative_path.strip():
            raise ToolError("TOOL_PATH_FORBIDDEN", "Only relative paths inside the shared directory are allowed")
        current = self.root
        for part in candidate.parts:
            current = current / part
            if self._is_reparse_point(current):
                raise ToolError("TOOL_PATH_FORBIDDEN", "Reparse points and symbolic links are not allowed")
        target = (self.root / candidate).resolve(strict=False)
        try:
            target.relative_to(self.root)
        except ValueError as error:
            raise ToolError("TOOL_PATH_FORBIDDEN", "The requested path is outside the shared directory") from error
        if must_exist and not target.exists():
            raise ToolError("TOOL_FILE_NOT_FOUND", "The requested file does not exist")
        return target
    def search_names(self, query: str, max_results: int = 20) -> list[str]:
        normalized = query.strip().casefold()
        if not normalized:
            raise ToolError("TOOL_ARGUMENT_INVALID", "Search query cannot be empty")
        limit = max(1, min(max_results, 50))
        results: list[str] = []
        for directory, directories, files in os.walk(self.root, followlinks=False):
            directory_path = Path(directory)
            directories[:] = [
                name for name in directories
                if not self._is_reparse_point(directory_path / name)
            ]
            for name in sorted(files):
                path = directory_path / name
                if self._is_reparse_point(path) or path.suffix.lower() not in TEXT_EXTENSIONS:
                    continue
                if normalized in name.casefold():
                    results.append(path.relative_to(self.root).as_posix())
                    if len(results) >= limit:
                        return results
        return results
    def read_text(self, relative_path: str) -> str:
        target = self._safe_path(relative_path, must_exist=True)
        if not target.is_file() or target.suffix.lower() not in TEXT_EXTENSIONS:
            raise ToolError("TOOL_FILE_TYPE_FORBIDDEN", "Only approved text file types can be read")
        if target.stat().st_size > MAX_FILE_BYTES:
            raise ToolError("TOOL_FILE_TOO_LARGE", "The file exceeds the 64 KiB limit")
        try:
            return target.read_text(encoding="utf-8-sig")
        except UnicodeDecodeError as error:
            raise ToolError("TOOL_FILE_ENCODING_INVALID", "The file must use UTF-8 encoding") from error


class WindowsDesktopAdapter:
    APPLICATIONS = {
        "notepad": ["notepad.exe"],
        "calculator": ["calc.exe"],
    }

    def __init__(self, shared_root: Path) -> None:
        self.shared_root = shared_root

    def current_time(self) -> str:
        return datetime.now().astimezone().isoformat()

    def system_info(self) -> dict[str, str]:
        return {
            "operating_system": platform.system(),
            "release": platform.release(),
            "architecture": platform.machine(),
            "python": platform.python_version(),
        }

    def open_url(self, url: str) -> str:
        parsed = urlsplit(url.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise ToolError("TOOL_URL_FORBIDDEN", "Only HTTP/HTTPS URLs without embedded credentials are allowed")
        safe_url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
        os.startfile(safe_url)  # type: ignore[attr-defined]
        return f"Opened {parsed.scheme}://{parsed.hostname}"

    def open_app(self, application: str) -> str:
        if application == "explorer":
            command = ["explorer.exe", str(self.shared_root)]
        else:
            command = self.APPLICATIONS.get(application)
        if command is None:
            raise ToolError("TOOL_APPLICATION_FORBIDDEN", "Application is not on the allowlist")
        subprocess.Popen(command, shell=False, close_fds=True)
        return f"Opened {application}"

    def read_clipboard(self) -> str:
        if sys.platform != "win32":
            raise ToolError("TOOL_PLATFORM_UNSUPPORTED", "Clipboard tools require Windows")
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        user32.GetClipboardData.restype = ctypes.c_void_p
        kernel32.GlobalLock.restype = ctypes.c_void_p
        if not user32.OpenClipboard(None):
            raise ToolError("TOOL_CLIPBOARD_UNAVAILABLE", "Clipboard is currently unavailable")
        try:
            handle = user32.GetClipboardData(13)
            if not handle:
                return ""
            pointer = kernel32.GlobalLock(handle)
            if not pointer:
                raise ToolError("TOOL_CLIPBOARD_UNAVAILABLE", "Clipboard text could not be read")
            try:
                text = ctypes.wstring_at(pointer)
            finally:
                kernel32.GlobalUnlock(handle)
            if len(text) > MAX_CLIPBOARD_CHARS:
                raise ToolError("TOOL_CLIPBOARD_TOO_LARGE", "Clipboard text exceeds 10,000 characters")
            return text
        finally:
            user32.CloseClipboard()

    def write_clipboard(self, text: str) -> str:
        if len(text) > MAX_CLIPBOARD_CHARS:
            raise ToolError("TOOL_CLIPBOARD_TOO_LARGE", "Clipboard text exceeds 10,000 characters")
        if sys.platform != "win32":
            raise ToolError("TOOL_PLATFORM_UNSUPPORTED", "Clipboard tools require Windows")
        command = [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Set-Clipboard -Value ([Console]::In.ReadToEnd())",
        ]
        subprocess.run(command, input=text, text=True, timeout=5, check=True, shell=False)
        return "Clipboard text updated"
