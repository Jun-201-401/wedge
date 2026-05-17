from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from app.rule_engine.handler_utils import base_hit, observations_of_type
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import ObservationRecord, StageContext

MAX_PROBLEM_CARDS = 10
IMAGE_URL_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif")
PRICE_PATTERN = re.compile(r"(?:[$]\s?\d[\d,.]*|\d[\d,.]*\s?(?:USD|KRW|원|만원|천원))", re.IGNORECASE)


def evaluate_product_image_load(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    candidates = [
        candidate
        for record in observations_of_type(context, "product_card")
        for candidate in _missing_image_cards(record)
    ]
    if not candidates:
        return None

    product_checkpoint_ids = {candidate["record"].checkpoint_id for candidate in candidates}
    image_failure_refs = _image_failure_refs(context, product_checkpoint_ids)
    if not image_failure_refs:
        return None

    problem_cards = candidates[:MAX_PROBLEM_CARDS]
    product_refs = _unique_refs([candidate["record"].ref for candidate in problem_cards])
    evidence_refs = _unique_refs([*product_refs, *image_failure_refs])
    missing_count = len(candidates)
    failed_count = len(image_failure_refs)
    labels = [_card_label(candidate["card"]) for candidate in problem_cards]
    label_signal = "|".join(label for label in labels if label)

    signals = [
        f"missing_product_image_card_count={missing_count}",
        f"image_failure_evidence_count={failed_count}",
    ]
    if label_signal:
        signals.append(f"missing_product_image_card_labels={label_signal}")

    severity = 2 if missing_count <= 3 else 3
    confidence = min(0.9, max(0.78, _average_confidence([candidate["record"] for candidate in problem_cards]) + 0.12))

    return base_hit(
        rule=rule,
        context=context,
        severity=severity,
        confidence=confidence,
        evidence_refs=evidence_refs,
        observations=[
            f"상품 카드 {missing_count}개에서 상품 이미지는 보이지 않고, 같은 화면에서 이미지 리소스 실패가 관찰됨"
        ],
        signals=signals,
        summary="상품 카드에서 이미지가 보이지 않아 상품을 시각적으로 확인하기 어렵습니다.",
        impact_hypothesis="사용자는 상품명과 가격은 볼 수 있지만 상품 이미지를 확인하지 못해 상품 비교나 구매 판단을 망설일 수 있습니다.",
        recommendations=[
            "상품 이미지 요청 실패를 해결하고, 이미지가 실패할 때 대체 이미지나 명확한 안내를 보여주는 방안을 고려하기"
        ],
        validation_questions=[
            "상품 카드의 이미지 영역이 정상 이미지, 대체 이미지, 또는 명확한 실패 안내 중 하나로 보이나요?"
        ],
    )


def _missing_image_cards(record: ObservationRecord) -> list[dict[str, Any]]:
    cards = _cards_from_observation(record.observation)
    candidates: list[dict[str, Any]] = []
    for index, card in enumerate(cards, start=1):
        if not _is_missing_image_product_card(card):
            continue
        candidates.append({"record": record, "card": card, "index": index})
    return candidates


def _cards_from_observation(observation: dict[str, Any]) -> list[dict[str, Any]]:
    data = observation.get("data") if isinstance(observation.get("data"), dict) else observation
    cards = data.get("cards") if isinstance(data, dict) else None
    if not isinstance(cards, list):
        return []
    return [card for card in cards if isinstance(card, dict)]


def _is_missing_image_product_card(card: dict[str, Any]) -> bool:
    if card.get("visible_product_image") is not False:
        return False
    if not isinstance(card.get("bbox"), dict):
        return False
    return _has_product_signal(card)


def _has_product_signal(card: dict[str, Any]) -> bool:
    visible_price = card.get("visible_price")
    if isinstance(visible_price, str) and visible_price.strip():
        return True
    text = card.get("element_text")
    if isinstance(text, str) and PRICE_PATTERN.search(text):
        return True
    return False


def _image_failure_refs(context: StageContext, checkpoint_ids: set[str]) -> list[str]:
    refs: list[str] = []
    for checkpoint in context.checkpoints:
        checkpoint_id = str(checkpoint.get("checkpoint_id") or "")
        if checkpoint_id not in checkpoint_ids:
            continue
        for observation in checkpoint.get("observations") or []:
            if not isinstance(observation, dict):
                continue
            if _observation_has_image_failure(observation):
                observation_id = str(observation.get("observation_id") or "unknown")
                if observation_id != "unknown":
                    refs.append(f"{checkpoint_id}.{observation_id}")
    return _unique_refs(refs)


def _observation_has_image_failure(observation: dict[str, Any]) -> bool:
    observation_type = observation.get("type")
    data = observation.get("data") if isinstance(observation.get("data"), dict) else observation
    if not isinstance(data, dict):
        return False

    if observation_type == "network_timeline":
        events = data.get("events")
        if isinstance(events, list):
            return any(_is_failed_image_event(event) for event in events if isinstance(event, dict))

    if observation_type == "network_failure":
        return _is_image_failure_message(data)

    return False


def _is_failed_image_event(event: dict[str, Any]) -> bool:
    failed = event.get("failed") is True
    status = _to_int(event.get("status"))
    is_error_status = status is not None and status >= 400
    if not failed and not is_error_status:
        return False
    return _is_image_resource(event.get("url"), event.get("resourceType") or event.get("resource_type"))


def _is_image_failure_message(data: dict[str, Any]) -> bool:
    url = data.get("url")
    message = data.get("message") or data.get("error") or data.get("text")
    resource_type = data.get("resourceType") or data.get("resource_type")
    if _is_image_resource(url, resource_type):
        return True
    if isinstance(message, str):
        return _is_image_resource(_url_from_message(message), resource_type)
    return False


def _is_image_resource(url: Any, resource_type: Any) -> bool:
    if isinstance(resource_type, str) and resource_type.lower() == "image":
        return True
    if not isinstance(url, str) or not url:
        return False
    path = urlparse(url).path.lower()
    return path.endswith(IMAGE_URL_EXTENSIONS)


def _url_from_message(message: str) -> str | None:
    match = re.search(r"https?://\S+", message)
    if not match:
        return None
    return match.group(0).rstrip(").,;")


def _to_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def _card_label(card: dict[str, Any]) -> str:
    text = card.get("element_text")
    if not isinstance(text, str) or not text.strip():
        return "상품 카드"
    return " ".join(text.split())[:80]


def _average_confidence(records: list[ObservationRecord]) -> float:
    values: list[float] = []
    for record in records:
        value = record.observation.get("confidence")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            values.append(float(value))
    if not values:
        return 0.66
    return sum(values) / len(values)


def _unique_refs(refs: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for ref in refs:
        if ref in seen:
            continue
        seen.add(ref)
        result.append(ref)
    return result
