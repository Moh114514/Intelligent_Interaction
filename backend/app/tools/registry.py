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
Details = Callable[[dict[str, Any]], dict[str, Any] | None]


@dataclass
class RegisteredTool:
    descriptor: ToolDescriptor
    executor: Executor
    summary: Callable[[dict[str, Any]], str]
    details: Details = lambda _arguments: None


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, RegisteredTool] = {}
        self._provider_aliases: dict[str, str] = {}

    def register(self, tool: RegisteredTool) -> None:
        if tool.descriptor.risk_level == "L3":
            raise ValueError("L3 tools cannot be registered")
        if tool.descriptor.name in self._tools or tool.descriptor.provider_name in self._provider_aliases:
            raise ValueError(f"Duplicate tool: {tool.descriptor.name}")
        Draft202012Validator.check_schema(tool.descriptor.parameters)
        self._tools[tool.descriptor.name] = tool
        self._provider_aliases[tool.descriptor.provider_name] = tool.descriptor.name

    def definitions(self) -> list[dict[str, Any]]:
        return [tool.descriptor.provider_definition() for tool in self._tools.values()]

    def canonical_name(self, name: str) -> str:
        return self._provider_aliases.get(name, name)

    def descriptor(self, name: str) -> ToolDescriptor:
        tool = self._tools.get(self.canonical_name(name))
        if tool is None:
            raise ToolError("TOOL_NOT_ALLOWED", "The requested tool is not available")
        return tool.descriptor

    def confirmation_summary(self, name: str, arguments: dict[str, Any]) -> str:
        return self._validated(name, arguments).summary(arguments)

    def confirmation_details(self, name: str, arguments: dict[str, Any]) -> dict[str, Any] | None:
        return self._validated(name, arguments).details(arguments)

    async def execute(self, name: str, arguments: dict[str, Any]) -> ToolExecutionResult:
        tool = self._validated(name, arguments)
        try:
            value = await asyncio.wait_for(asyncio.to_thread(tool.executor, arguments), timeout=tool.descriptor.timeout_seconds)
        except (asyncio.TimeoutError, TimeoutError):
            return ToolExecutionResult("timed_out", '{"error":"tool timed out"}', "Tool timed out", "TOOL_TIMEOUT")
        except ToolError as error:
            return ToolExecutionResult("failed", json.dumps({"error": error.message, "error_code": error.error_code}, ensure_ascii=False), error.message, error.error_code)
        except Exception:
            return ToolExecutionResult("failed", '{"error":"tool execution failed","error_code":"TOOL_EXECUTION_FAILED"}', "Tool execution failed", "TOOL_EXECUTION_FAILED")
        content = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
        return ToolExecutionResult("succeeded", content, tool.summary(arguments))

    def _validated(self, name: str, arguments: dict[str, Any]) -> RegisteredTool:
        tool = self._tools.get(self.canonical_name(name))
        if tool is None or tool.descriptor.risk_level == "L3":
            raise ToolError("TOOL_NOT_ALLOWED", "The requested tool is not available")
        try:
            Draft202012Validator(tool.descriptor.parameters).validate(arguments)
        except ValidationError as error:
            raise ToolError("TOOL_ARGUMENT_INVALID", "Tool arguments failed schema validation") from error
        return tool


def object_schema(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {"type": "object", "additionalProperties": False, "properties": properties, "required": required or []}


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

    def add(name: str, description: str, risk: str, parameters: dict[str, Any], executor: Executor, summary: Callable[[dict[str, Any]], str], details: Details = lambda _args: None) -> None:
        registry.register(RegisteredTool(ToolDescriptor(name, description, risk, parameters, timeout_seconds), executor, summary, details))  # type: ignore[arg-type]

    empty = object_schema({})
    text = {"type": "string", "maxLength": 65536}
    add("system.current_time", "Get the current local time with timezone.", "L0", empty, lambda _: desktop_adapter.current_time(), lambda _: "\u8bfb\u53d6\u5f53\u524d\u65f6\u95f4")
    add("system.info", "Get basic operating system, architecture, and Python version.", "L0", empty, lambda _: desktop_adapter.system_info(), lambda _: "\u8bfb\u53d6\u57fa\u672c\u7cfb\u7edf\u4fe1\u606f")
    add("desktop.open_url", "Open an HTTP or HTTPS URL in the default browser.", "L1", object_schema({"url": {"type": "string", "minLength": 1, "maxLength": 2048}}, ["url"]), lambda args: desktop_adapter.open_url(args["url"]), lambda args: f"\u6253\u5f00\u7f51\u5740\uff1a{url_host(args['url'])}")
    add("desktop.open_app", "Open an allowlisted Windows application.", "L1", object_schema({"application": {"type": "string", "enum": ["notepad", "calculator", "explorer"]}}, ["application"]), lambda args: desktop_adapter.open_app(args["application"]), lambda args: f"\u6253\u5f00\u5e94\u7528\uff1a{args['application']}")
    add("clipboard.read_text", "Read plain text from the Windows clipboard.", "L1", empty, lambda _: desktop_adapter.read_clipboard(), lambda _: "\u8bfb\u53d6\u526a\u8d34\u677f\u6587\u672c")
    add(
        "clipboard.write_text", "Replace Windows clipboard text after user confirmation.", "L2",
        object_schema({"text": {"type": "string", "maxLength": 10000}}, ["text"]),
        lambda args: desktop_adapter.write_clipboard(args["text"]), lambda _: "\u5199\u5165\u526a\u8d34\u677f",
        lambda args: {"target": "\u526a\u8d34\u677f", "operation": "clipboard", "content": args["text"], "content_length": len(args["text"]), "will_create_backup": False},
    )
    add(
        "files.search_names", "Resolve an exact absolute file path or search common document and media filenames on non-sensitive fixed local drives. User confirmation is required.", "L2",
        object_schema({"query": {"type": "string", "minLength": 1, "maxLength": 1024}, "max_results": {"type": "integer", "minimum": 1, "maximum": 50}}, ["query"]),
        lambda args: file_adapter.search_names(args["query"], args.get("max_results", 20)),
        lambda args: file_adapter.search_summary(args["query"]),
        lambda args: file_adapter.search_details(args["query"]),
    )
    add(
        "files.read_file", "Read a searched file by file_id. Text and documents are extracted; media returns metadata. User confirmation is required.", "L2",
        object_schema({"file_id": {"type": "string", "minLength": 1, "maxLength": 64}}, ["file_id"]),
        lambda args: file_adapter.read_file(args["file_id"]), lambda args: f"\u8bfb\u53d6\u6587\u4ef6\uff1a{file_adapter.reference_details(args['file_id'])['target']}",
        lambda args: file_adapter.reference_details(args["file_id"]),
    )
    add(
        "files.create_text", "Create a new UTF-8 text file. A relative path uses the Garfield Chat Shared directory; an approved absolute path is also accepted. User confirmation of the exact target and full content is required.", "L2",
        object_schema({"path": {"type": "string", "minLength": 3, "maxLength": 1024}, "content": text}, ["path", "content"]),
        lambda args: file_adapter.create_text(args["path"], args["content"]), lambda args: f"\u65b0\u5efa\u6587\u672c\u6587\u4ef6\uff1a{file_adapter.create_details(args['path'], args['content'])['target']}",
        lambda args: file_adapter.create_details(args["path"], args["content"]),
    )
    add(
        "files.replace_text", "Replace a searched UTF-8 text file by file_id and create a backup. User confirmation is required.", "L2",
        object_schema({"file_id": {"type": "string", "minLength": 1, "maxLength": 64}, "content": text}, ["file_id", "content"]),
        lambda args: file_adapter.replace_text(args["file_id"], args["content"]), lambda args: f"\u8986\u76d6\u6587\u672c\u6587\u4ef6\u5e76\u521b\u5efa\u5907\u4efd\uff1a{file_adapter.replace_details(args['file_id'], args['content'])['target']}",
        lambda args: file_adapter.replace_details(args["file_id"], args["content"]),
    )
    add(
        "files.read_text", "Read one approved UTF-8 text file from the legacy shared directory. User confirmation is required.", "L2",
        object_schema({"relative_path": {"type": "string", "minLength": 1, "maxLength": 260}}, ["relative_path"]),
        lambda args: file_adapter.read_text(args["relative_path"]), lambda args: f"\u8bfb\u53d6\u5171\u4eab\u6587\u4ef6\uff1a{Path(args['relative_path']).as_posix()}",
    )
    return registry


def url_host(url: str) -> str:
    from urllib.parse import urlsplit
    return urlsplit(url).hostname or "invalid"
