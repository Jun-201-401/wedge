from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body

from app.services.analysis_service import analyze_packet

router = APIRouter(prefix="/internal", tags=["analysis"])


@router.post("/analyze")
def analyze(evidence_packet: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return analyze_packet(evidence_packet)
