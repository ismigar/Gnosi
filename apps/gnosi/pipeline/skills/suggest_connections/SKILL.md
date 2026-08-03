# SKILL: Brain Connection Proposals

This skill generates evidence-backed, read-only connection proposals for the
configured Brain and exposes the same queue to the inbox and global graph.

> ID: GRAPH-MGMT-20260408
> Status: ACTIVE

---

## 1. Canonical generation

Analyze Brain reading and manual permanent notes for connections, support,
contradictions, and gaps.

- **Config**: `<vault>/.gnosi/llm_wiki.json` and the managed Brain agent.
- **Source of truth**: `<vault>/.gnosi/llm_wiki_suggestions.json`.
- **CLI**: `python3 -c "from backend.services.llm_wiki_actions import run_maintenance; print(run_maintenance(semantic=True))"`
- **Runtime**: the `suggest_connections` scheduler invokes the same service.

---

## 2. Review contract

- Proposals may be inspected, opened, or dismissed.
- The automation never creates or edits a permanent note.
- Dismissal updates the canonical queue and invalidates the graph response.
- Only existing Brain page IDs may become proposal members.

---

## 3. Model and scheduling

- Model selection follows the managed Brain agent and Gnosi's provider factory.
- Manual semantic maintenance and the explicitly enabled
  `suggest_connections` scheduler may invoke the model.
- Daily LLM Wiki maintenance and `update_memories` are deterministic and must
  never invoke semantic generation.

---

## 4. Restrictions and learned safeguards

- Do not write a second generated graph under `BD/`; it diverges from the inbox.
- Do not call the removed `suggest_connections_digital_brain` module.
- Do not report a structured generator error as scheduler success.
- Add proposal edges directly from the queue as a non-structural response
  overlay, and invalidate the graph response cache whenever the queue changes.
