from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib import error, request


class EvidencePacketFetchError(RuntimeError):
    def __init__(self, status_code: int, response_body: str) -> None:
        super().__init__(f"Evidence packet fetch failed with HTTP {status_code}: {response_body}")
        self.status_code = status_code
        self.response_body = response_body


@dataclass(frozen=True)
class EvidencePacketClient:
    base_url: str
    auth_token: str = ""
    timeout_seconds: float = 10.0

    def fetch_by_run_id(self, run_id: str) -> dict[str, Any]:
        http_request = request.Request(
            f"{self.base_url.rstrip('/')}/api/runs/{run_id}/evidence-packet",
            method="GET",
            headers=self._headers(),
        )
        try:
            with request.urlopen(http_request, timeout=self.timeout_seconds) as response:
                response_body = response.read().decode("utf-8")
        except error.HTTPError as exc:
            response_body = exc.read().decode("utf-8")
            raise EvidencePacketFetchError(exc.code, response_body) from exc

        decoded = _decode_json_object(response_body)
        packet = decoded.get("data", decoded)
        if not isinstance(packet, dict):
            raise EvidencePacketFetchError(response.status, "Evidence packet response data must be an object.")
        return packet

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"
        return headers


def _decode_json_object(response_body: str) -> dict[str, Any]:
    try:
        decoded = json.loads(response_body)
    except json.JSONDecodeError as exc:
        raise EvidencePacketFetchError(200, "Evidence packet response must be valid JSON.") from exc
    if not isinstance(decoded, dict):
        raise EvidencePacketFetchError(200, "Evidence packet response must be a JSON object.")
    return decoded
