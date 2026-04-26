from __future__ import annotations

from dataclasses import asdict, dataclass

from app.api import api_router
from app.clients import analyzer_clients
from app.schemas import analyzer_schemas
from app.services.feature_extraction import feature_extraction_service
from app.services.llm_analysis import llm_analysis_service
from app.services.model_inference import model_inference_service
from app.services.report_support import report_support_service
from app.rule_engine import analyze_evidence_packet, load_default_registry
from app.shared import shared_state
from app.workers import worker_registry


@dataclass(frozen=True)
class AnalyzerApp:
    service: str
    status: str
    components: dict[str, object]


def create_app() -> AnalyzerApp:
    return AnalyzerApp(
        service="analyzer",
        status="scaffold",
        components={
            "api": api_router,
            "workers": worker_registry,
            "schemas": analyzer_schemas,
            "feature_extraction": feature_extraction_service,
            "model_inference": model_inference_service,
            "llm_analysis": llm_analysis_service,
            "report_support": report_support_service,
            "rule_engine": {
                "status": "available",
                "default_registry_id": load_default_registry()["registry_id"],
                "analyze": analyze_evidence_packet,
            },
            "clients": analyzer_clients,
            "shared": shared_state,
        },
    )


app = asdict(create_app())
