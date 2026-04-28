from __future__ import annotations

from fastapi import APIRouter

from app.schemas.analysis import HealthResponse
from app.services.analysis_service import analyzer_health

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(**analyzer_health())
