from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass
from typing import Any
from urllib import error, request


class SpringCallbackError(RuntimeError):
    def __init__(self, status_code: int, response_body: str) -> None:
        super().__init__(f"Spring callback failed with HTTP {status_code}: {response_body}")
        self.status_code = status_code
        self.response_body = response_body


@dataclass(frozen=True)
class SpringCallbackResponse:
    status_code: int
    body: dict[str, Any] | str | None


class SpringCallbackClient:
    def __init__(
        self,
        *,
        base_url: str,
        worker_id: str,
        service_token: str,
        signing_secret: str,
        timeout_seconds: float = 10.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._worker_id = worker_id
        self._service_token = service_token
        self._signing_secret = signing_secret
        self._timeout_seconds = timeout_seconds

    def send_started(
        self,
        *,
        analysis_job_id: str,
        payload: dict[str, Any],
        event_id: str,
    ) -> SpringCallbackResponse:
        return self._post(
            path=f"/internal/analysis/jobs/{analysis_job_id}/started",
            payload=payload,
            event_id=event_id,
        )

    def send_completed(
        self,
        *,
        analysis_job_id: str,
        payload: dict[str, Any],
        event_id: str,
    ) -> SpringCallbackResponse:
        return self._post(
            path=f"/internal/analysis/jobs/{analysis_job_id}/completed",
            payload=payload,
            event_id=event_id,
        )

    def send_failed(
        self,
        *,
        analysis_job_id: str,
        payload: dict[str, Any],
        event_id: str,
    ) -> SpringCallbackResponse:
        return self._post(
            path=f"/internal/analysis/jobs/{analysis_job_id}/failed",
            payload=payload,
            event_id=event_id,
        )

    def _post(self, *, path: str, payload: dict[str, Any], event_id: str) -> SpringCallbackResponse:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        http_request = request.Request(
            f"{self._base_url}{path}",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self._service_token}",
                "Content-Type": "application/json; charset=utf-8",
                "X-Worker-Id": self._worker_id,
                "X-Event-Id": event_id,
                "X-Signature": self._signature(body),
            },
        )
        try:
            with request.urlopen(http_request, timeout=self._timeout_seconds) as response:
                response_body = response.read().decode("utf-8")
                return SpringCallbackResponse(
                    status_code=response.status,
                    body=_decode_response_body(response_body),
                )
        except error.HTTPError as exc:
            response_body = exc.read().decode("utf-8")
            raise SpringCallbackError(exc.code, response_body) from exc

    def _signature(self, body: bytes) -> str:
        digest = hmac.new(
            self._signing_secret.encode("utf-8"),
            body,
            hashlib.sha256,
        ).hexdigest()
        return f"hmac-sha256={digest}"


def _decode_response_body(response_body: str) -> dict[str, Any] | str | None:
    if not response_body:
        return None
    try:
        decoded = json.loads(response_body)
    except json.JSONDecodeError:
        return response_body
    if isinstance(decoded, dict):
        return decoded
    return response_body
