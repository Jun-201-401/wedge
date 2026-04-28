from __future__ import annotations

from pydantic import BaseModel


class HealthResponse(BaseModel):
    service: str
    status: str
    rule_registry_id: str
