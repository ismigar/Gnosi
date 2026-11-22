"""Freeze one governed profile, model and skill for an entire source job."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from collections.abc import Callable
from typing import Any, Never, TYPE_CHECKING, TypedDict

if TYPE_CHECKING:
    from backend.domains.llm_wiki.semantic_quote_selection import QuoteSelection
    from backend.services.agent_output_repair import OutputRepair

from backend.services.agent_execution_models import AgentExecutionSnapshot, AgentOperation

from backend.domains.llm_wiki.reading_skill import SKILL_ID, SKILL_VERSION


def token_bound(text: str) -> int:
    """Conservative byte-token bound; no tokenizer downloads or hidden I/O."""
    return len(text.encode("utf-8"))


def compact_structured_input(prompt: str) -> str:
    """Remove transport whitespace only; evidence and saved contracts stay exact."""
    payload = json.loads(prompt)
    payload.pop("output_schema", None)
    payload["instruction"] = str(payload.get("instruction", "")) + (
        " Serialize the JSON response without indentation or whitespace outside string values."
        " Preserve all substantive content, explanations, qualifications and evidence selections;"
        " this is a formatting preference, not a request to shorten the content."
    )
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _validated_structured_output(text: str, selection: QuoteSelection | None, draft_schema: dict[str, Any] | None,
                                 source_review: bool, validate: Callable[[dict[str, object]], None]) -> str:
    import jsonschema
    from backend.domains.llm_wiki.reading_batch_recovery import PassageReviewIssue
    try:
        answer = json.loads(selection.restore(text, draft_schema=draft_schema) if selection else text)
        if not isinstance(answer, dict):
            raise ValueError("Return a JSON object")
    except (ValueError, jsonschema.ValidationError) as error:
        if source_review:
            raise PassageReviewIssue(str(error)) from error
        raise
    try:
        validate(answer)
    except (TypeError, KeyError) as error:
        raise ValueError(str(error)) from error
    # Legacy validation can restore an omitted segment digest. Selection
    # operations keep their numeric contract in the operation cache;
    # the reader receives literal citations after the operation returns.
    return text if selection else json.dumps(answer, ensure_ascii=False)


class _OutputOptions(TypedDict, total=False):
    draft_schema: dict[str, Any]
    observe_model_output: Callable[[str, bool], None]


def _draft_schema(envelope: Any, selection: QuoteSelection | None, paired_reader: bool) -> dict[str, Any] | None:
    # Keep strict contracts on the provider request. Store provisional siblings
    # locally so a rejected passage cannot erase a paid decision on another.
    if isinstance(envelope, dict) and envelope.get("phase") == "source-audit-batch":
        return {"type": "object"}
    return selection.draft_schema() if selection and paired_reader else None


def _observe_audit_findings(text: str, amendment: bool, validate: Callable[[dict[str, object]], None], seen: dict[str, None]) -> str:
    import jsonschema
    from backend.domains.llm_wiki.audit_amendments import open_findings, amendment_findings
    from backend.services.agent_execution import _validate_output
    try:
        normalized = _validate_output(text, {"type": "object"})
        proposal = json.loads(normalized)
    except (ValueError, jsonschema.ValidationError):
        return text
    issues = list(open_findings(proposal).values())
    if amendment:
        issues.extend(amendment_findings(proposal))
    seen.update(dict.fromkeys(issues))
    record = getattr(validate, "record_findings", None)
    if issues and record:
        record(issues)
    return normalized


def _structured_error(error: Exception, issues: dict[str, None], source_review: bool, selection: QuoteSelection | None) -> Never:
    import jsonschema
    from backend.domains.llm_wiki.audit_findings import ReportedAuditIssues
    from backend.domains.llm_wiki.reading_batch_recovery import PassageReviewIssue
    from backend.services.structured_output_diagnostics import ModelOutputError, repair_diagnostic
    if issues:
        raise ReportedAuditIssues(list(issues), repair_diagnostic(error)) from error
    if isinstance(error, (ModelOutputError, jsonschema.ValidationError)) and source_review:
        raise PassageReviewIssue(repair_diagnostic(error)) from error
    if isinstance(error, jsonschema.ValidationError) and selection and {"primary_quote_ids", "context_quote_ids"}.intersection(error.absolute_path):
        raise ValueError("Invalid reading plan: " + repair_diagnostic(error)) from error
    raise error


@dataclass
class ReadingRuntime:
    agent_id: str
    provider: str
    model: str
    instructions: str
    input_budget: int
    snapshot: AgentExecutionSnapshot
    cost_optimization: bool = True
    reuse_results: bool = True
    skill_id: str = SKILL_ID

    @property
    def audit_batch_size(self) -> int:
        from backend.domains.llm_wiki.audit_groups import AUDIT_BATCH_SIZE
        return AUDIT_BATCH_SIZE

    @property
    def performance_options(self) -> dict[str, object]:
        from backend.services.reading_performance import eligible
        return {"reading_pinned": True, "reading_result_cache": self.reuse_results,
                **({"reading_performance": self.cost_optimization} if eligible(self.provider, self.model) else {})}

    def count_tokens(self, text: str, *, output_schema: dict[str, object] | None = None) -> int:
        from backend.services.agent_context_budget import count_tokens
        from backend.services.agent_behavior import operation_input
        from langchain_core.messages import HumanMessage

        # The operation wraps the JSON reading prompt in another JSON envelope,
        # then the central budget measures serialized messages. Counting only
        # the raw prompt misses escaping and the repeated output schema, which
        # can reject a whole-source delivery before its first model call.
        try:
            envelope = json.loads(text)
        except ValueError:
            envelope = None
        schema = output_schema if output_schema is not None else envelope.get("output_schema") if isinstance(envelope, dict) else None
        request = AgentOperation(
            skill_id=self.skill_id, operation="knowledge.process-source.phase", input=text,
            output_schema=schema if isinstance(schema, dict) else {"type": "object"},
        )
        message = HumanMessage(content=operation_input(request))
        serialized = json.dumps([message.model_dump(mode="json")], ensure_ascii=False)
        return count_tokens(serialized, self.model if self.snapshot.behavior_resources else "").tokens

    def count_structured_tokens(self, prompt: str) -> int:
        """Size the available audit wire or conservatively bound other reading phases."""
        from backend.domains.llm_wiki.semantic_quote_selection import quote_selection
        envelope = json.loads(prompt)
        if envelope.get("phase") in {"source-audit", "source-audit-batch"}:
            return self._structured_input(prompt, envelope)[3]
        canonical = self.count_tokens(prompt)
        selection = quote_selection(envelope)
        if selection is None:
            return canonical
        operation = compact_structured_input(selection.input)
        return max(canonical, self.count_tokens(operation, output_schema=selection.schema))

    @property
    def identity(self) -> str:
        frozen = self.snapshot.model_dump(exclude={"parent_run_id", "origin", "catalog_revision", "revision"})
        # The effective skills, instructions, scope, model and resources are in the snapshot.
        # Changes to other catalog entries or to the review assignment do not change this reader.
        frozen["profile"].get("_execution_operation_bindings", {}).pop("reading-review", None)
        payload = [
            SKILL_VERSION,
            self.agent_id,
            self.provider,
            self.model,
            self.instructions,
            self.input_budget,
            frozen,
        ]
        return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()

    def compatible_legacy_revision(self, job_id: str) -> str:
        """Verify old single-agent drafts against the actual scoped job snapshot."""
        from backend.services import agent_execution_store as store
        from backend.services import llm_wiki_storage
        try:
            data = store.reading_job_snapshot(self.snapshot.scope, job_id)
            if not data:
                return ""
            old = AgentExecutionSnapshot.model_validate(data)
        except (LookupError, ValueError):
            return ""
        if old.scope != self.snapshot.scope or old.agent_id != self.agent_id or old.profile.get("model") != self.model:
            return ""
        if runtime_for_snapshot(old.scope.vault_path, old, SKILL_ID).identity != self.identity:
            return ""
        execution = llm_wiki_storage.get_job_status(job_id).get("execution")
        if isinstance(execution, dict) and execution.get("agent_id") == old.agent_id:
            return str(execution.get("execution_revision") or "")
        return ""

    @property
    def reading_engine(self) -> str:
        return "semantic" if self.snapshot.behavior_resources else "legacy"

    @property
    def metadata(self) -> dict[str, object]:
        return {
            "agent_id": self.agent_id,
            "provider": self.provider,
            "model": self.model,
            "skill_id": self.skill_id,
            "skill_version": SKILL_VERSION if self.skill_id == SKILL_ID else self.snapshot.skill_versions[self.skill_id],
            "reading_engine": self.reading_engine,
            "execution_revision": self.identity,
        }

    def generate(
        self, prompt: str, *, user_message: str = "", timeout: int = 120
    ) -> tuple[str, str]:
        from backend.services.agent_execution import run_sync

        if self.count_tokens(prompt) > self.input_budget:
            raise RuntimeError("The reading input exceeds the selected model's context budget")
        result = run_sync(AgentOperation(
            skill_id=self.skill_id, operation="knowledge.process-source.phase",
            input=prompt, timeout_seconds=timeout, origin="worker", options=self.performance_options,
        ), snapshot=self.snapshot)
        return result.result, result.model

    def _structured_input(self, prompt: str, envelope: Any) -> tuple[QuoteSelection | None, str, dict[str, Any], int]:
        from backend.domains.llm_wiki.semantic_quote_selection import quote_selection
        canonical = envelope.get("output_schema") if isinstance(envelope, dict) else None
        if not isinstance(canonical, dict):
            canonical = {"type": "object"}
        # A narrow review window may fit the original literal field but not the numbered catalog.
        for numbered in (True, False):
            selection = quote_selection(envelope, number_audit_evidence=numbered) if isinstance(envelope, dict) else None
            operation_input = compact_structured_input(selection.input) if selection else prompt
            if isinstance(envelope, dict) and envelope.get("phase") == "source-audit-batch":
                operation_input = compact_structured_input(prompt)
            schema = selection.schema if selection else canonical
            size = self.count_tokens(operation_input, output_schema=schema)
            if size <= self.input_budget or not selection or not selection.audit_evidence:
                break
        if size > self.input_budget and isinstance(envelope, dict) and "initial_passage_context" in envelope:
            prior = {k: v for k, v in envelope.items() if k != "initial_passage_context"}
            return self._structured_input(json.dumps(prior, ensure_ascii=False), prior)
        return selection, operation_input, schema, size

    def _structured_operation(self, prompt: str, schema: dict[str, Any], timeout: int, max_calls: int,
                              options: dict[str, object]) -> AgentOperation:
        return AgentOperation(skill_id=self.skill_id, operation="knowledge.process-source.phase",
            input=prompt, timeout_seconds=timeout, origin="worker", resume_requires_parent=True,
            options={**self.performance_options, **options}, output_schema=schema, max_model_calls=max_calls)

    def _recover_reader_draft(self, envelope: dict[str, Any], validate: Callable[[dict[str, object]], None],
                              timeout: int, current_wire: str) -> tuple[str, str] | None:
        from backend.services.agent_execution import recover_reading_operation
        if "initial_passage_context" not in envelope:
            return None
        prior = {k: v for k, v in envelope.items() if k != "initial_passage_context"}
        selection, wire, schema, _ = self._structured_input(json.dumps(prior, ensure_ascii=False), prior)
        if selection is None or wire == current_wire:
            return None
        draft_schema = selection.draft_schema()
        def restore(text: str) -> str:
            answer = selection.restore(text, draft_schema=draft_schema)
            validate(json.loads(answer))
            return answer
        return recover_reading_operation(self._structured_operation(wire, schema, timeout, 2, {}),
            self.snapshot, self.provider, self.model, restore, draft_schema=draft_schema)

    def recover_audit(self, prompt: str, validate: Callable[[dict[str, object]], None], timeout: int,
                      *, literal_only: bool = False) -> tuple[str, str]:
        """Look up validated audit operations, including a coverage pass whose phase write was interrupted."""
        from backend.domains.llm_wiki.contextual_reading import ReadingCheckpointUnavailable
        from backend.domains.llm_wiki.semantic_quote_selection import quote_selection
        from backend.services.agent_execution import recover_reading_operation
        envelope = json.loads(prompt)
        for numbered in ((False,) if literal_only else (False, True)):
            selection = quote_selection(envelope, number_audit_evidence=numbered)
            wire = compact_structured_input(selection.input) if selection else prompt
            schema = selection.schema if selection else envelope["output_schema"]
            operation = self._structured_operation(wire, schema, timeout, 2, {})
            def restored(text: str) -> str:
                item = json.loads(selection.restore(text) if selection else text)
                validate(item)
                return json.dumps(item, ensure_ascii=False)
            recovered = recover_reading_operation(operation, self.snapshot, self.provider, self.model, restored)
            if recovered is not None:
                return recovered
        raise ReadingCheckpointUnavailable("No validated source audit for this request")

    def _reading_operation(self, prompt: str, schema: dict[str, Any], timeout: int, envelope: Any) -> AgentOperation:
        data = envelope if isinstance(envelope, dict) else {}
        options: dict[str, object] = {}
        calls = 2 if data.get("reading_engine") == "semantic" else 3
        if data.get("phase") == "source-audit-batch":
            options["reading_review_notes"] = len(data["passages"])
            calls = 1
        elif data.get("phase") == "verify" and data.get("reading_engine") == "semantic":
            options["reading_review_notes"] = len(data.get("notes", []))
        return self._structured_operation(prompt, schema, timeout, calls, options)

    def generate_structured(self, prompt: str, validate: Callable[[dict[str, object]], None], timeout: int) -> tuple[str, str]:
        import jsonschema
        from backend.domains.llm_wiki.contextual_reading import ReadingCheckpointUnavailable
        from backend.domains.llm_wiki.reading_batch_recovery import ReadingInputTooLarge
        from backend.services.agent_execution import run_sync
        from backend.services.agent_output_repair import OutputRepair
        try:
            envelope = json.loads(prompt)
        except ValueError:
            envelope = None
        selection, operation_prompt, schema, size = self._structured_input(prompt, envelope)
        if size > self.input_budget:
            raise ReadingInputTooLarge("The reading input exceeds the selected model's context budget")
        paired_reader = (selection is not None and self.skill_id == SKILL_ID and envelope["phase"] == "interpret"
                         and "needs_specialist" in envelope["output_schema"]["properties"]["passages"]["items"]["properties"])
        draft_schema = _draft_schema(envelope, selection, paired_reader)
        source_review = (isinstance(envelope, dict) and envelope.get("reading_engine") == "semantic"
                         and envelope.get("phase") in {"source-repair", "source-audit", "source-audit-batch", "verify"})
        individual = source_review and envelope["phase"] == "source-audit"
        audit_findings: dict[str, None] = {}
        def observe(text: str, amendment: bool) -> None:
            _observe_audit_findings(text, amendment, validate, audit_findings)
        def checked(text: str) -> str:
            return _validated_structured_output(text, selection, draft_schema, source_review, validate)
        def repair(text: str, error: Exception) -> OutputRepair | None:
            if individual:
                text = _observe_audit_findings(text, False, validate, audit_findings)
            return self._repair_structured(prompt, envelope, selection, validate, text, error)
        try:
            operation = self._reading_operation(operation_prompt, schema, timeout, envelope)
            if paired_reader:
                old_draft = self._recover_reader_draft(envelope, validate, timeout, operation_prompt)
                if old_draft is not None:
                    return old_draft
            if selection and selection.audit_evidence:
                try:
                    return self.recover_audit(prompt, validate, timeout, literal_only=True)
                except ReadingCheckpointUnavailable:
                    pass
            options: _OutputOptions = {}
            if draft_schema is not None:
                options["draft_schema"] = draft_schema
            if individual:
                options["observe_model_output"] = observe
            result = run_sync(operation, snapshot=self.snapshot, output_validator=checked, output_repair=repair, **options)
        except (ValueError, jsonschema.ValidationError) as error:
            _structured_error(error, audit_findings, source_review, selection)
        return selection.restore(result.result, draft_schema=draft_schema) if selection else result.result, result.model

    def _repair_structured(self, prompt: str, envelope: Any, selection: QuoteSelection | None,
                           validate: Callable[[dict[str, object]], None], text: str, error: Exception) -> OutputRepair | None:
        from backend.domains.llm_wiki.reading_dimension_repairs import build_dimension_repair
        from backend.domains.llm_wiki.reading_repairs import build_reading_repair
        from backend.services.agent_output_repair import OutputRepair
        if (isinstance(envelope, dict) and envelope.get("reading_engine") == "semantic" and
                envelope.get("phase") == "source-audit" and "evidence_quote" in
                envelope.get("output_schema", {}).get("properties", {})):
            from backend.domains.llm_wiki.audit_amendments import build_audit_amendment
            from backend.domains.llm_wiki.semantic_quote_selection import QuoteSelection
            audit = selection or QuoteSelection(prompt, envelope["output_schema"], {}, "source-audit", [])
            amendment = build_audit_amendment(audit, text, validate, error, fits=lambda repair:
                self.count_tokens(compact_structured_input(repair.input), output_schema=repair.output_schema) <= self.input_budget)
            if amendment is None:
                return None
            return OutputRepair(compact_structured_input(amendment.input), amendment.output_schema, amendment.restore)
        if selection and isinstance(error, json.JSONDecodeError):
            # Some providers report stop even when a long structured answer
            # ends inside a value, including short review prefixes. Retrying
            # the complete batch repeats all
            # originals; let the reader split it inside the same book cap.
            incomplete = error.msg.startswith("Unterminated string") or error.pos >= len(text.rstrip()) - 1
            review_started = selection.phase == "verify" and text.lstrip().startswith("{")
            if incomplete and (len(text.encode()) >= 4096 or review_started):
                from backend.domains.llm_wiki.reading_batch_recovery import IncompleteReadingBatch
                raise IncompleteReadingBatch() from error
        # A schema rejection can hide bad citations in the same draft.
        # Collect both before spending another call on a full rewrite.
        if isinstance(envelope, dict) and envelope.get("reading_engine") == "semantic":
            from backend.domains.llm_wiki.semantic_repairs import build_semantic_repair
            semantic_repair: OutputRepair | None
            try:
                if selection and selection.phase == "verify":
                    semantic_repair = selection.review_repair(text, error)
                else:
                    draft = selection.draft_for_repair(text) if selection else text
                    semantic_repair = build_semantic_repair(prompt, draft)
                    if semantic_repair is not None and selection:
                        semantic_repair = selection.repair(semantic_repair)
            except ValueError:
                return None
            if semantic_repair is not None:
                semantic_repair = OutputRepair(compact_structured_input(semantic_repair.input),
                                              semantic_repair.output_schema, semantic_repair.restore)
            return semantic_repair if semantic_repair is not None and self.count_tokens(
                semantic_repair.input, output_schema=semantic_repair.output_schema) <= self.input_budget else None
        plan = build_dimension_repair(prompt, text, validate)
        if plan is None:
            plan = build_reading_repair(prompt, text, error)
        if plan is not None and self.count_tokens(plan.input) > self.input_budget:
            return None
        return plan

    def generate_prose(self, prompt: str, validate: Callable[[str], str], timeout: int) -> tuple[str, str]:
        """Argument maps are prose; the application serializes their checkpoint."""
        from backend.services.agent_execution import run_sync
        if self.count_tokens(prompt) > self.input_budget:
            raise RuntimeError("The reading input exceeds the selected model's context budget")
        try:
            envelope = json.loads(prompt)
        except ValueError:
            envelope = None
        bounded = isinstance(envelope, dict) and envelope.get("map_contract") == "bounded-reduction-v1"
        result = run_sync(AgentOperation(skill_id=self.skill_id, operation="knowledge.process-source.phase",
            input=prompt, timeout_seconds=timeout, origin="worker", resume_requires_parent=True,
            options={"reading_prose": True, **self.performance_options}, max_model_calls=1 if bounded else 2),
            snapshot=self.snapshot, output_validator=validate)
        return result.result, result.model


def prepare_reading_runtime(vault_root: str | Path) -> ReadingRuntime:
    from backend.services.agent_execution import prepare_snapshot
    return runtime_for_snapshot(vault_root, prepare_snapshot(SKILL_ID), SKILL_ID)


def prepare_review_runtime(vault_root: str | Path, reader: AgentExecutionSnapshot) -> ReadingRuntime:
    from backend.services.agent_execution import prepare_reading_reviewer
    from backend.services.agent_operation_catalog import skill_id
    return runtime_for_snapshot(vault_root, prepare_reading_reviewer(reader), skill_id("reading-review"))


def runtime_for_snapshot(vault_root: str | Path, snapshot: AgentExecutionSnapshot,
                         selected_skill: str) -> ReadingRuntime:
    from backend.domains.agent.runtime_tools import _model_context_window
    if selected_skill not in snapshot.skill_ids:
        raise PermissionError("agent_execution_skill_unavailable")
    if Path(snapshot.scope.vault_path).resolve() != Path(vault_root).resolve():
        raise PermissionError("agent_execution_vault_mismatch")
    profile = snapshot.profile
    provider, model = str(profile.get("provider") or ""), str(profile.get("model") or "")
    if not provider or not model:
        raise ValueError("reading_profile_model_required")
    from backend.services.agent_behavior import snapshot_instruction_text
    instructions = snapshot_instruction_text(snapshot)
    window = _model_context_window(provider, model)
    from backend.services.agent_context_budget import count_tokens
    from langchain_core.messages import SystemMessage
    system = json.dumps([SystemMessage(content=instructions).model_dump(mode="json")], ensure_ascii=False)
    budget = window - max(2_048, window // 4) - count_tokens(system, model if snapshot.behavior_resources else "").tokens - 512
    if budget < 4_000:
        raise RuntimeError("Choose a model with a larger context window for source reading")
    return ReadingRuntime(snapshot.agent_id, provider, model, instructions, budget, snapshot, skill_id=selected_skill)
