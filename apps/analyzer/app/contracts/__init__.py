"""Analyzer-local contract helpers.

These helpers intentionally stay dependency-free and mirror the canonical JSON
contracts in packages/contracts without becoming a separate source of truth.
"""

from app.contracts.stages import DECISION_STAGE_DISPLAY_NAMES, DECISION_STAGES, DecisionStage

__all__ = ["DECISION_STAGE_DISPLAY_NAMES", "DECISION_STAGES", "DecisionStage"]
