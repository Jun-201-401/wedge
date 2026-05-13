from __future__ import annotations
from fastapi import FastAPI
from app.api import api_router
from app.observability.metrics import include_metrics_route


def create_app() -> FastAPI:
    app = FastAPI(
        title="Wedge Analyzer",
        version="0.1.0",
    )
    app.include_router(api_router)
    include_metrics_route(app)
    return app


app = create_app()
