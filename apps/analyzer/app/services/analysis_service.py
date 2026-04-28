from __future__ import annotations

from typing import Any

from app.rule_engine import analyze_evidence_packet, load_default_registry


def analyzer_health() -> dict[str, str]:
    registry = load_default_registry()
    return {
        "service": "analyzer",
        "status": "ok",
        "rule_registry_id": str(registry.get("registry_id") or "unknown"),
    }


def analyze_packet(evidence_packet: dict[str, Any]) -> dict[str, Any]:
    return analyze_evidence_packet(evidence_packet)
