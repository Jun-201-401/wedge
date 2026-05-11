from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from http.client import IncompleteRead
from pathlib import Path
from typing import Any
from urllib import error, request


class GMSClientError(RuntimeError):
    pass


@dataclass(frozen=True)
class GMSConfig:
    enabled: bool = False
    api_key: str = ""
    base_url: str = "https://gms.ssafy.io/gmsapi"
    openai_responses_path: str = "api.openai.com/v1/responses"
    model: str = "gpt-4.1-nano"
    timeout_seconds: float = 20.0

    @classmethod
    def from_env(cls) -> "GMSConfig":
        load_analyzer_dotenv()
        return cls(
            enabled=_env_bool("ANALYZER_GMS_ENABLED", default=False),
            api_key=os.environ.get("ANALYZER_GMS_API_KEY", ""),
            base_url=os.environ.get("ANALYZER_GMS_BASE_URL", cls.base_url),
            openai_responses_path=os.environ.get("ANALYZER_GMS_OPENAI_RESPONSES_PATH", cls.openai_responses_path),
            model=os.environ.get("ANALYZER_GMS_MODEL", cls.model),
            timeout_seconds=_env_float("ANALYZER_GMS_TIMEOUT_SECONDS", default=cls.timeout_seconds),
        )

    @property
    def endpoint(self) -> str:
        return f"{self.base_url.rstrip('/')}/{self.openai_responses_path.lstrip('/')}"


class GMSClient:
    """OpenAI Responses-compatible GMS adapter.

    GMS keeps the upstream request shape but proxies it through the GMS base
    URL. This adapter intentionally exposes text only; downstream services must
    sanitize and decide which fields are allowed to affect JudgeResult.
    """

    def __init__(self, config: GMSConfig | None = None) -> None:
        self._config = config or GMSConfig.from_env()

    def generate_text(self, *, prompt: str) -> str:
        body = {
            "model": self._config.model,
            "input": prompt,
        }
        return self._generate(body)

    def generate_with_image(self, *, prompt: str, image_url: str) -> str:
        body = {
            "model": self._config.model,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": prompt},
                        {"type": "input_image", "image_url": image_url},
                    ],
                }
            ],
        }
        return self._generate(body)

    def _generate(self, body: dict[str, Any]) -> str:
        if not self._config.enabled:
            raise GMSClientError("GMS is disabled")
        if not self._config.api_key:
            raise GMSClientError("ANALYZER_GMS_API_KEY is not configured")

        request_body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        http_request = request.Request(
            self._config.endpoint,
            data=request_body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept-Encoding": "identity",
                "Connection": "close",
                "Authorization": f"Bearer {self._config.api_key}",
            },
        )

        try:
            with request.urlopen(http_request, timeout=self._config.timeout_seconds) as response:
                response_body = response.read().decode("utf-8")
        except IncompleteRead as exc:
            partial = exc.partial or b""
            response_body = partial.decode("utf-8", errors="replace")
            if not response_body.strip():
                raise GMSClientError("GMS response read was incomplete with an empty partial body") from exc
        except error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")[:500]
            raise GMSClientError(f"GMS request failed with HTTP {exc.code}: {details}") from exc
        except error.URLError as exc:
            raise GMSClientError(f"GMS request failed: {exc.reason}") from exc
        except TimeoutError as exc:
            raise GMSClientError("GMS request timed out") from exc

        try:
            payload = json.loads(response_body)
        except json.JSONDecodeError as exc:
            partial_text = extract_openai_response_text_from_body(response_body)
            if partial_text:
                return partial_text
            raise GMSClientError("GMS returned non-JSON response") from exc

        return extract_openai_response_text(payload)


def extract_openai_response_text(payload: Any) -> str:
    if not isinstance(payload, dict):
        raise GMSClientError("GMS response must be a JSON object")

    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text

    choices = payload.get("choices")
    if isinstance(choices, list):
        for choice in choices:
            if not isinstance(choice, dict):
                continue
            message = choice.get("message")
            if isinstance(message, dict) and isinstance(message.get("content"), str):
                return message["content"]
            if isinstance(choice.get("text"), str):
                return choice["text"]

    output = payload.get("output")
    if isinstance(output, list):
        texts: list[str] = []
        for item in output:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for content_item in content:
                if not isinstance(content_item, dict):
                    continue
                text = content_item.get("text")
                if isinstance(text, str):
                    texts.append(text)
        if texts:
            return "\n".join(texts)

    raise GMSClientError("GMS response did not contain output text")


def extract_openai_response_text_from_body(response_body: str) -> str | None:
    for key in ("output_text", "text"):
        pattern = rf'"{key}"\s*:\s*"((?:\\.|[^"\\])*)"'
        for match in re.finditer(pattern, response_body):
            try:
                value = json.loads(f'"{match.group(1)}"')
            except json.JSONDecodeError:
                continue
            if isinstance(value, str) and value.strip():
                return value
    return None


def _env_bool(name: str, *, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, *, default: float) -> float:
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def load_analyzer_dotenv(path: str | Path | None = None) -> None:
    dotenv_path = Path(path) if path is not None else Path(__file__).resolve().parents[2] / ".env"
    if not dotenv_path.exists():
        return
    for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = _strip_env_value(value.strip())
        if key and key not in os.environ:
            os.environ[key] = value


def _strip_env_value(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value
