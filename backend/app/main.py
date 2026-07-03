from __future__ import annotations

import argparse
import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app import __version__
from backend.app.agent.runtime import AgentRuntime
from backend.app.api.routes import create_router
from backend.app.core.config import Settings
from backend.app.core.logging import configure_logging
from backend.app.tools import create_default_registry
from backend.app.tools.audit import create_audit_logger
from backend.app.providers import LLMProvider, OpenAICompatibleProvider


def create_app(settings: Settings | None = None, provider: LLMProvider | None = None) -> FastAPI:
    resolved = settings or Settings.from_env()
    log_path = configure_logging(resolved.log_dir, resolved.log_level)
    resolved_provider = provider or OpenAICompatibleProvider(
        api_key=resolved.llm_api_key,
        base_url=resolved.llm_base_url,
        model=resolved.llm_model,
        timeout_seconds=resolved.llm_timeout_seconds,
    )
    registry = create_default_registry(resolved.tool_shared_root, timeout_seconds=resolved.tool_timeout_seconds)
    audit_logger = create_audit_logger(resolved.log_dir)
    agent_runtime = AgentRuntime(
        resolved_provider,
        registry,
        audit_logger,
        max_history_messages=resolved.llm_max_history_messages,
        max_tool_steps=resolved.agent_max_tool_steps,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield

    app = FastAPI(
        title="Intelligent Interaction Agent",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^http://(127\.0\.0\.1|localhost)(:\d+)?$",
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.state.settings = resolved
    app.state.log_path = str(log_path)
    app.state.agent_runtime = agent_runtime
    app.include_router(create_router(resolved, agent_runtime))
    return app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the local Agent sidecar")
    parser.add_argument("--host", default=os.getenv("AGENT_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("AGENT_PORT", "8765")))
    return parser.parse_args()


def run() -> None:
    args = parse_args()
    os.environ["AGENT_HOST"] = args.host
    os.environ["AGENT_PORT"] = str(args.port)
    settings = Settings.from_env()
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, log_config=None)


if __name__ == "__main__":
    run()
