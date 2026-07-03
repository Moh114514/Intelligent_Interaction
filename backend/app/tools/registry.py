from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

from backend.app.tools.adapters import FileAdapter, WindowsDesktopAdapter
from backend.app.tools.models import ToolDescriptor, ToolError, ToolExecutionResult

Executor = Callable[[dict[str, Any]], Any]


@dataclass
class RegisteredTool:
    descriptor: ToolDescriptor
    executor: Executor
    summary: Callable[[dict[str, Any]], str]


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, RegisteredTool] = {}

    def register(self, tool: RegisteredTool) -> None:
        if tool.descriptor.risk_level == "L3":
            raise ValueError("L3 tools cannot be registered")
        if tool.descriptor.name in self._tools:
            raise ValueError(f"Duplicate tool: {tool.descriptor.name}")
        Draft202012Validator.check_schema(tool.descriptor.parameters)
        self._tools[tool.descriptor.name] = tool

    def definitions(self) -> list[dict[str, Any]]:
        return [tool.descriptor.provider_definition() for tool in self._tools.values()]

    def descriptor(self, name: str) -> ToolDescriptor:
        tool = self._tools.get(name)
        if tool is None:
            raise ToolError("TOOL_NOT_ALLOWED", "The requested tool is not available")
        return tool.descriptor

    def confirmation_summary(self, name: str, arguments: dict[str, Any]) -> str:
        tool = self._validated(name, arguments)
        return tool.summary(arguments)

    async def execute(self, name: str, arguments: dict[str, Any]) -> ToolExecutionResult:
        tool = self._validated(name, arguments)
        try:
            value = await asyncio.wait_for(
                asyncio.to_thread(tool.executor, arguments),
                timeout=tool.descriptor.timeout_seconds,
            )
        except (asyncio.TimeoutError, TimeoutError):
            return ToolExecutionResult("timed_out", '{"error":"tool timed out"}', "Tool timed out", "TOOL_TIMEOUT")
        except ToolError as error:
            return ToolExecutionResult(
                "failed",
                json.dumps({"error": error.message, "error_code": error.error_code}, ensure_ascii=False),
                error.message,
                error.error_code,
            )
        except Exception:
            return ToolExecutionResult(
                "failed",
                '{"error":"tool execution failed","error_code":"TOOL_EXECUTION_FAILED"}',
                "Tool execution failed",
                "TOOL_EXECUTION_FAILED",
            )
        content = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
        return ToolExecutionResult("succeeded", content, tool.summary(arguments))

    def _validated(self, name: str, arguments: dict[str, Any]) -> RegisteredTool:
        tool = self._tools.get(name)
        if tool is None or tool.descriptor.risk_level == "L3":
            raise ToolError("TOOL_NOT_ALLOWED", "The requested tool is not available")
        try:
            Draft202012Validator(tool.descriptor.parameters).validate(arguments)
        except ValidationError as error:
            raise ToolError("TOOL_ARGUMENT_INVALID", "Tool arguments failed schema validation") from error
        return tool


def object_schema(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": properties,
        "required": required or [],
    }


def create_default_registry(
    shared_root: Path,
    *,
    timeout_seconds: float = 10,
    files: FileAdapter | None = None,
    desktop: WindowsDesktopAdapter | None = None,
) -> ToolRegistry:
    file_adapter = files or FileAdapter(shared_root)
    desktop_adapter = desktop or WindowsDesktopAdapter(file_adapter.root)
    registry = ToolRegistry()

    def add(name: str, description: str, risk: str, parameters: dict[str, Any], executor: Executor, summary: Callable[[dict[str, Any]], str]) -> None:
        registry.register(RegisteredTool(ToolDescriptor(name, description, risk, parameters, timeout_seconds), executor, summary))  # type: ignore[arg-type]

    empty = object_schema({})
    add("system.current_time", "Get the current local time with timezone.", "L0", empty, lambda _: desktop_adapter.current_time(), lambda _: "Read current time")
    add("system.info", "Get basic operating system, architecture, and Python version.", "L0", empty, lambda _: desktop_adapter.system_info(), lambda _: "Read basic system information")
    add("desktop.open_url", "Open an HTTP or HTTPS URL in the default browser.", "L1", object_schema({"url": {"type": "string", "minLength": 1, "maxLength": 2048}}, ["url"]), lambda args: desktop_adapter.open_url(args["url"]), lambda args: f"Open URL host: {url_host(args['url'])}")
    add("desktop.open_app", "Open an allowlisted Windows application.", "L1", object_schema({"application": {"type": "string", "enum": ["notepad", "calculator", "explorer"]}}, ["application"]), lambda args: desktop_adapter.open_app(args["application"]), lambda args: f"Open application: {args['application']}")
    add("clipboard.read_text", "Read plain text from the Windows clipboard.", "L1", empty, lambda _: desktop_adapter.read_clipboard(), lambda _: "Read clipboard text")
    add("clipboard.write_text", "Replace Windows clipboard text.", "L1", object_schema({"text": {"type": "string", "maxLength": 10000}}, ["text"]), lambda args: desktop_adapter.write_clipboard(args["text"]), lambda _: "Write clipboard text")
    add("files.search_names", "Search approved text file names inside the shared directory.", "L1", object_schema({"query": {"type": "string", "minLength": 1, "maxLength": 100}, "max_results": {"type": "integer", "minimum": 1, "maximum": 50}}, ["query"]), lambda args: file_adapter.search_names(args["query"], args.get("max_results", 20)), lambda _: "Search file names in shared directory")
    add("files.read_text", "Read one approved UTF-8 text file from the shared directory. User confirmation is required.", "L2", object_schema({"relative_path": {"type": "string", "minLength": 1, "maxLength": 260}}, ["relative_path"]), lambda args: file_adapter.read_text(args["relative_path"]), lambda args: f"Read shared file: {Path(args['relative_path']).as_posix()}")
    return registry


def url_host(url: str) -> str:
    from urllib.parse import urlsplit

    return urlsplit(url).hostname or "invalid"
