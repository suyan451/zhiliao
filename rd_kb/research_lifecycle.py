from __future__ import annotations

from typing import Any


RESEARCH_LIFECYCLE_STATUSES = ("待读", "粗读", "精读", "已实验", "已结论", "已归档")


class ResearchLifecycleError(ValueError):
    """Raised when a research lifecycle transition is invalid."""


def normalize_research_status(status: str) -> str:
    raw = str(status or "").strip()
    if raw in RESEARCH_LIFECYCLE_STATUSES:
        return raw
    if any(token in raw for token in ("已归档", "归档")):
        return "已归档"
    if any(token in raw for token in ("已验证", "验证完成", "有价值", "最佳", "有效", "已结论")):
        return "已结论"
    if any(token in raw for token in ("已实验", "实验完成", "已复现")):
        return "已实验"
    if any(token in raw for token in ("已阅读", "待精读", "精读")):
        return "精读"
    if any(token in raw for token in ("粗读", "速读", "初读")):
        return "粗读"
    return "待读"


def transition_research_status(current_status: str, next_status: str, payload: dict[str, Any]) -> str:
    current = normalize_research_status(current_status)
    next_value = normalize_research_status(next_status)
    if next_value not in RESEARCH_LIFECYCLE_STATUSES:
        raise ResearchLifecycleError(f"Unsupported research status: {next_status}")
    if next_value == "已归档":
        return next_value
    if _index(next_value) < _index(current):
        raise ResearchLifecycleError(f"Cannot move research lifecycle backwards: {current} -> {next_value}")
    if next_value == "已实验" and not _has_experiment_evidence(payload):
        raise ResearchLifecycleError("已实验 requires experiment observation or failure reason")
    if next_value == "已结论" and not _has_conclusion(payload):
        raise ResearchLifecycleError("已结论 requires verification conclusion or industrial value")
    return next_value


def _index(status: str) -> int:
    return RESEARCH_LIFECYCLE_STATUSES.index(status)


def _has_experiment_evidence(payload: dict[str, Any]) -> bool:
    return bool(
        str(payload.get("experimentExperience") or "").strip()
        or str(payload.get("failureReason") or "").strip()
        or str(payload.get("experimentObservation") or "").strip()
    )


def _has_conclusion(payload: dict[str, Any]) -> bool:
    return bool(
        str(payload.get("verificationConclusion") or "").strip()
        or str(payload.get("industrialValue") or "").strip()
    )
