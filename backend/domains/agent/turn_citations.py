"""Citation extraction and validation for governed agent turns."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, quote, urlparse

from langchain_core.messages import BaseMessage, ToolMessage

from backend.services.vault_routing import canonical_vault_browser_path

_browser_path_resolver: Callable[[str, str], str] = canonical_vault_browser_path


def configure_browser_path_resolver(
    resolver: Callable[[str, str], str],
) -> None:
    """Configure the historical browser-path seam at the compatibility edge."""
    global _browser_path_resolver
    _browser_path_resolver = resolver


CITATION_MARKER_RE = re.compile(r"\[\[cite:([A-Za-z0-9][A-Za-z0-9._:-]{0,191})\]\]")


MAX_CITATION_SOURCES = 96


MAX_CITATION_CLAIMS = 128


NOTEBOOK_EVIDENCE_TOOL_NAMES = frozenset(
    {
        "search_notebook_context",
        "read_notebook_context_evidence",
        "read_notebook_context_analysis",
    }
)


def _current_turn_tool_messages(messages: Iterable[BaseMessage]) -> list[ToolMessage]:
    current: list[ToolMessage] = []
    for message in reversed(list(messages)):
        if str(getattr(message, "type", "") or "") == "human":
            break
        if isinstance(message, ToolMessage):
            current.append(message)
    return list(reversed(current))


def _tool_payload(message: ToolMessage) -> dict[str, Any]:
    content = getattr(message, "content", "")
    if not isinstance(content, str):
        return {}
    try:
        payload = json.loads(content)
    except (TypeError, ValueError, json.JSONDecodeError):
        tool_name = str(getattr(message, "name", "") or "")
        if tool_name not in NOTEBOOK_EVIDENCE_TOOL_NAMES:
            return {}
        start_marker = "<<<START EXTERNAL CONTENT>>>\n"
        end_marker = "\n<<<END EXTERNAL CONTENT>>>"
        start = content.find(start_marker)
        end = content.rfind(end_marker)
        if start < 0 or end <= start:
            return {}
        try:
            payload = json.loads(content[start + len(start_marker) : end])
        except (TypeError, ValueError, json.JSONDecodeError):
            return {}
    return payload if isinstance(payload, dict) else {}


def _safe_job(
    tool_name: str, payload: Mapping[str, Any], plan: Mapping[str, Any]
) -> dict[str, Any] | None:
    local_id = str(payload.get("job_id") or payload.get("id") or "").strip()
    if not local_id or not (tool_name.startswith("start_") or "analysis_status" in tool_name):
        return None
    provider = str((plan.get("job") or {}).get("provider") or "reader")
    job_id = local_id if ":" in local_id else f"{provider}:{local_id}"
    raw_retry = payload.get("retry")
    retry = raw_retry if isinstance(raw_retry, Mapping) else {}

    def nonnegative_int(value: Any) -> int:
        try:
            return max(0, int(value or 0))
        except (TypeError, ValueError):
            return 0

    return {
        "job_id": job_id[:256],
        "provider": provider[:64],
        "status": str(payload.get("status") or payload.get("state") or "queued")[:64],
        "progress": payload.get("progress")
        if isinstance(payload.get("progress"), (int, float))
        else None,
        "result_available": bool(payload.get("result_available")),
        "retry": {
            "automatic_enabled": bool(retry.get("automatic_enabled")),
            "attempt": nonnegative_int(retry.get("attempt")),
            "max_attempts": nonnegative_int(retry.get("max_attempts")),
            "next_retry_at": str(retry.get("next_retry_at") or "")[:64] or None,
            "model_call_budget": nonnegative_int(retry.get("model_call_budget")),
            "model_calls_used": nonnegative_int(retry.get("model_calls_used")),
            "last_retry_reason": str(retry.get("last_retry_reason") or "")[:128] or None,
            "budget_exhausted": bool(retry.get("budget_exhausted")),
        },
        "capabilities": {
            "status": True,
            "result": True,
            "resume": True,
            "cancel": bool(payload.get("cancellable", True)),
            "automatic_retry": bool(retry.get("automatic_enabled")),
        },
    }


def _bounded_label(value: Any, fallback: str, limit: int = 240) -> str:
    """Return one single-line presentation label without source content."""
    label = " ".join(str(value or "").split()).strip()
    return (label or fallback)[:limit]


def _safe_source_href(*, source_id: str, source_kind: str, url: Any = "") -> str:
    """Return an internal or HTTP(S) source link, never a filesystem path."""
    candidate = str(url or "").strip()
    if candidate:
        parsed = urlparse(candidate)
        if parsed.scheme in {"http", "https"} and parsed.netloc:
            return candidate[:2_000]
        if source_kind == "notebook_evidence" and parsed.scheme == "gnosi-cite":
            query = parse_qs(parsed.query, keep_blank_values=False)
            required = {"res", "notebook", "revision", "chunk"}
            if (
                not parsed.netloc
                and not parsed.path
                and required.issubset(query)
                and all(len(query[key]) == 1 for key in required)
                and str(query["revision"][0]).isdigit()
            ):
                return candidate[:2_000]
    if not source_id:
        return ""
    encoded = quote(source_id, safe="")
    if source_kind == "reader_article":
        return _browser_path_resolver("reader", f"article/{encoded}")
    if source_kind == "vault_record":
        return _browser_path_resolver("knowledge", f"page/{encoded}")
    return ""


def _citation_id(source_kind: str, source_id: str) -> str:
    digest = hashlib.sha256(f"{source_kind}:{source_id}".encode("utf-8")).hexdigest()[:12]
    return f"src-{digest}"


@dataclass
class _CitationAccumulator:
    sources: list[dict[str, Any]] = field(default_factory=list)
    source_key_to_citation: dict[str, str] = field(default_factory=dict)
    ordered_record_citations: list[str] = field(default_factory=list)
    manifest_citations: list[str] = field(default_factory=list)
    seen_citations: set[str] = field(default_factory=set)

    def add_source(
        self,
        *,
        source_id: Any,
        title: Any,
        source_kind: str,
        url: Any = "",
        marker_keys: Iterable[Any] = (),
        version_data: Any = None,
    ) -> str:
        normalized_id = _bounded_label(source_id, "", 192)
        if not normalized_id or len(self.sources) >= MAX_CITATION_SOURCES:
            return ""
        citation_id = _citation_id(source_kind, normalized_id)
        if citation_id not in self.seen_citations:
            self._append_source(
                citation_id=citation_id,
                source_id=normalized_id,
                title=title,
                source_kind=source_kind,
                url=url,
                version_data=version_data,
            )
        self._index_markers(citation_id, normalized_id, marker_keys)
        return citation_id

    def _append_source(
        self,
        *,
        citation_id: str,
        source_id: str,
        title: Any,
        source_kind: str,
        url: Any,
        version_data: Any,
    ) -> None:
        self.seen_citations.add(citation_id)
        version_payload = (
            version_data if version_data not in (None, "") else {"source_id": source_id}
        )
        fingerprint = hashlib.sha256(
            json.dumps(
                version_payload,
                ensure_ascii=True,
                sort_keys=True,
                separators=(",", ":"),
                default=str,
            ).encode("utf-8")
        ).hexdigest()[:16]
        self.sources.append(
            {
                "citation_id": citation_id,
                "source_id": source_id,
                "title": _bounded_label(title, source_id),
                "source_type": source_kind,
                "href": _safe_source_href(
                    source_id=source_id,
                    source_kind=source_kind,
                    url=url,
                ),
                "source_version": fingerprint,
                "version_status": ("exact" if version_data not in (None, "") else "identity_only"),
            }
        )

    def _index_markers(
        self,
        citation_id: str,
        normalized_id: str,
        marker_keys: Iterable[Any],
    ) -> None:
        for marker_key in (normalized_id, *marker_keys):
            key = _bounded_label(marker_key, "", 192)
            if key:
                self.source_key_to_citation.setdefault(key, citation_id)

    def add_notebook_evidence(self, raw_row: Mapping[str, Any]) -> str:
        citation = raw_row.get("citation")
        if not isinstance(citation, Mapping):
            return ""
        chunk_id = _bounded_label(
            citation.get("chunk_id") or raw_row.get("chunk_id"),
            "",
            192,
        )
        if not chunk_id:
            return ""
        source_label = _bounded_label(
            raw_row.get("source_label") or raw_row.get("label"),
            str(citation.get("source_id") or chunk_id),
        )
        locator_label = _bounded_label(citation.get("label"), "", 120)
        title = (
            f"{source_label} · {locator_label}"
            if locator_label and locator_label != source_label
            else source_label
        )
        return self.add_source(
            source_id=chunk_id,
            title=title,
            source_kind="notebook_evidence",
            url=citation.get("href"),
            marker_keys=(
                raw_row.get("chunk_id"),
                raw_row.get("source_id"),
                citation.get("chunk_id"),
                citation.get("source_id"),
            ),
            version_data={
                "revision": citation.get("revision") or raw_row.get("revision"),
                "source_id": citation.get("source_id") or raw_row.get("source_id"),
                "chunk_id": chunk_id,
            },
        )

    def _add_collection(
        self,
        payload: Mapping[str, Any],
        *,
        collection_key: str,
        default_kind: str,
        tool_name: str,
    ) -> None:
        rows = payload.get(collection_key)
        if not isinstance(rows, list):
            return
        for raw_row in rows:
            if not isinstance(raw_row, Mapping):
                continue
            source_id = raw_row.get("id") or raw_row.get("source_id")
            if source_id in (None, ""):
                continue
            source_kind = self._source_kind(
                raw_row,
                collection_key=collection_key,
                default_kind=default_kind,
                tool_name=tool_name,
            )
            citation_id = self.add_source(
                source_id=source_id,
                title=(raw_row.get("title") or raw_row.get("name") or raw_row.get("label")),
                source_kind=source_kind,
                url=raw_row.get("url") or raw_row.get("href"),
                marker_keys=(raw_row.get("citation_key"),),
                version_data=(
                    raw_row.get("revision")
                    or raw_row.get("etag")
                    or raw_row.get("updated_at")
                    or raw_row.get("modified_at")
                ),
            )
            if citation_id and collection_key == "records":
                self.ordered_record_citations.append(citation_id)

    @staticmethod
    def _source_kind(
        raw_row: Mapping[str, Any],
        *,
        collection_key: str,
        default_kind: str,
        tool_name: str,
    ) -> str:
        reader_record = collection_key == "records" and (
            tool_name.startswith("inspect_reader")
            or "article" in tool_name
            or bool(raw_row.get("published_at"))
        )
        return "reader_article" if reader_record else default_kind

    def add_tool(
        self,
        *,
        index: int,
        tool: ToolMessage,
        tool_name: str,
        payload: Mapping[str, Any],
    ) -> None:
        if str(getattr(tool, "status", "") or "") == "error" or payload.get("error"):
            return
        manifest = self.add_source(
            source_id=f"{tool_name or 'tool'}:{index + 1}",
            title=f"{tool_name or 'Tool'} result",
            source_kind="tool_result",
            marker_keys=(tool_name,),
            version_data=payload,
        )
        if manifest:
            self.manifest_citations.append(manifest)
        if self._add_notebook_payload(tool_name, payload):
            return
        for collection_key, default_kind in (
            ("records", "vault_record"),
            ("articles", "reader_article"),
            ("sources", "source"),
            ("results", "source"),
            ("items", "source"),
            ("citations", "source"),
        ):
            self._add_collection(
                payload,
                collection_key=collection_key,
                default_kind=default_kind,
                tool_name=tool_name,
            )

    def _add_notebook_payload(
        self,
        tool_name: str,
        payload: Mapping[str, Any],
    ) -> bool:
        if tool_name not in NOTEBOOK_EVIDENCE_TOOL_NAMES:
            return False
        rows: list[Mapping[str, Any]] = []
        if payload.get("chunk_id") and isinstance(payload.get("citation"), Mapping):
            rows.append(payload)
        results = payload.get("results")
        if isinstance(results, list):
            rows.extend(row for row in results if isinstance(row, Mapping))
        for row in rows:
            self.add_notebook_evidence(row)
        return bool(rows)


def _citation_evidence(
    tools: Sequence[ToolMessage],
    tool_names: Sequence[str],
    payloads: Sequence[Mapping[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, str], list[str], list[str]]:
    """Build safe source descriptors from successful current-turn evidence."""
    accumulator = _CitationAccumulator()
    for index, (tool, tool_name, payload) in enumerate(zip(tools, tool_names, payloads)):
        accumulator.add_tool(
            index=index,
            tool=tool,
            tool_name=tool_name,
            payload=payload,
        )
    return (
        accumulator.sources,
        accumulator.source_key_to_citation,
        accumulator.ordered_record_citations,
        accumulator.manifest_citations,
    )


def _claim_line_citations(
    *,
    cleaned: str,
    citation_ids: list[str],
    deterministic: bool,
    ordered_records: Sequence[str],
    manifests: Sequence[str],
    record_index: int,
) -> tuple[list[str], int]:
    if not deterministic or not cleaned.strip():
        return citation_ids, record_index
    if re.match(r"^\s*\d+\.\s+", cleaned) and record_index < len(ordered_records):
        return [ordered_records[record_index]], record_index + 1
    if not citation_ids and manifests:
        return [manifests[0]], record_index
    return citation_ids, record_index


def _scan_claims(
    text: str,
    *,
    source_key_to_citation: Mapping[str, str],
    deterministic: bool,
    ordered_records: Sequence[str],
    manifests: Sequence[str],
) -> tuple[str, list[dict[str, Any]], int]:
    claims: list[dict[str, Any]] = []
    cleaned_lines: list[str] = []
    unknown_markers = 0
    record_index = 0
    for line_index, raw_line in enumerate(str(text or "").splitlines()):
        marker_keys = CITATION_MARKER_RE.findall(raw_line)
        citation_ids = list(
            dict.fromkeys(
                source_key_to_citation[key] for key in marker_keys if key in source_key_to_citation
            )
        )
        unknown_markers += sum(key not in source_key_to_citation for key in marker_keys)
        cleaned = re.sub(
            r"\s+([.,;:!?])",
            r"\1",
            CITATION_MARKER_RE.sub("", raw_line).rstrip(),
        )
        cleaned_lines.append(cleaned)
        citation_ids, record_index = _claim_line_citations(
            cleaned=cleaned,
            citation_ids=citation_ids,
            deterministic=deterministic,
            ordered_records=ordered_records,
            manifests=manifests,
            record_index=record_index,
        )
        if citation_ids and cleaned.strip() and len(claims) < MAX_CITATION_CLAIMS:
            claims.append(
                {
                    "claim_id": f"claim-{len(claims) + 1}",
                    "line_index": line_index,
                    "text": _bounded_label(cleaned, "Claim", 320),
                    "citation_ids": citation_ids[:12],
                }
            )
    return "\n".join(cleaned_lines), claims, unknown_markers


def _citation_result_status(
    *,
    required: bool,
    has_tools: bool,
    sources: Sequence[Mapping[str, Any]],
    claims: Sequence[Mapping[str, Any]],
    unknown_markers: int,
) -> tuple[str, list[str]]:
    limitations: list[str] = []
    if unknown_markers:
        limitations.append("unknown_citation_id_rejected")
    if required and has_tools and not claims:
        limitations.append("claim_citations_missing")
    if any(not source.get("href") for source in sources):
        limitations.append("one_or_more_source_links_unavailable")
    if not required and not sources:
        return "not_applicable", limitations
    if claims and not unknown_markers:
        return "complete", limitations
    if sources:
        return "partial", limitations
    return "missing", limitations


def _claim_citations(
    text: str,
    *,
    tools: Sequence[ToolMessage],
    tool_names: Sequence[str],
    payloads: Sequence[Mapping[str, Any]],
    plan: Mapping[str, Any],
) -> tuple[str, dict[str, Any]]:
    """Validate citation markers and map visible claims to current evidence."""
    (
        sources,
        source_key_to_citation,
        ordered_records,
        manifests,
    ) = _citation_evidence(tools, tool_names, payloads)
    verification = plan.get("verification")
    required = bool(
        isinstance(verification, Mapping) and verification.get("source_evidence_required")
    )
    required_tool = str(plan.get("required_tool") or "")
    deterministic = (
        str(plan.get("output_strategy") or "") == "deterministic"
        or required_tool.startswith("start_")
        or "_status" in required_tool
    )
    cleaned_text, claims, unknown_markers = _scan_claims(
        text,
        source_key_to_citation=source_key_to_citation,
        deterministic=deterministic,
        ordered_records=ordered_records,
        manifests=manifests,
    )
    status, limitations = _citation_result_status(
        required=required,
        has_tools=bool(tools),
        sources=sources,
        claims=claims,
        unknown_markers=unknown_markers,
    )
    cited = {str(citation_id) for claim in claims for citation_id in claim["citation_ids"]}
    return cleaned_text, {
        "schema_version": 1,
        "status": status,
        "claim_count": len(claims),
        "source_count": len(cited),
        "sources": [source for source in sources if source["citation_id"] in cited],
        "claims": claims,
        "limitations": list(dict.fromkeys(limitations))[:8],
    }
