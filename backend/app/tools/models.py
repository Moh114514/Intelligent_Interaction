from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

ToolRisk = Literal["L0", "L1", "L2", "L3"]
ToolStatus = Literal["succeeded", "denied", "failed", "timed_out", "cancelled"]


class ToolError(Exception):
    def __init__(self, error_code: str, message: str):
        super().__init__(message)
        self.error_code = error_code
        self.message = message


@dataclass(frozen=True)
class ToolDescriptor:
    name: str
    description: str
    risk_level: ToolRisk
    parameters: dict[str, Any]
    timeout_seconds: float

    @property
    def provider_name(self) -> str:
        return self.name.replace(".", "_")

    def provider_definition(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.provider_name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ToolExecutionResult:
    status: ToolStatus
    content: str
    summary: str
    error_code: str | None = None
