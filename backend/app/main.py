from __future__ import annotations

import argparse
import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from fastapi.middleware.cors import CORSMiddleware
from backend.app import __version__
from backend.app.api.routes import create_router
from backend.app.core.config import Settings
from backend.app.core.logging import configure_logging


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or Settings.from_env()
    log_path = configure_logging(resolved.log_dir, resolved.log_level)

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
    app.include_router(create_router(resolved))
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
