# Configurable Brain agent

The Brain plugin stores `agent_id` in the vault's `.gnosi/llm_wiki.json`.
Existing vaults default to `llm-wiki`. Enabling the plugin seeds that managed
profile with the Brain skills and vault tools; subsequent lifecycle transitions
preserve user edits and skill assignments. The historical mandatory query skill
is no longer locked, so a customized copy can replace it.

Brain settings offer an agent selector and shortcuts to the existing agent and
skill editors. Plugin skills can be customized into editable user skills and
assigned to any profile; user skill instructions and tool assignments remain
editable through the normal Skills editor.

Brain maintenance belongs to the Brain table header, including tables embedded
in pages. The secondary “Brain tools” menu offers deterministic review and AI
connection proposals. Review results remain accessible in that view; completing
an AI audit refreshes and opens the existing read-only connection inbox. Settings
contain configuration only. Menus and dialogs use portals so embedded editor
toolbars cannot clip or cover them.

An agent-only configuration update works before table setup and neither modifies
schemas nor rebuilds indexes. It rejects unknown profile IDs. Ingestion,
connection proposals, and writing/dictation assistance use the selected profile.
One-shot generation includes its persona, context, and available assigned skill
instructions. Explicit skills are included only for their matching Brain
operation. These calls do not bind tools or start nested agent workflows.

An explicitly selected profile must exist, be enabled, and have a model. Failure
to instantiate that model must never fall back to an unrelated agent or provider.
Disabled plugin tools and unavailable skills retain their catalog restrictions.
Deterministic maintenance still makes no model calls.

Validation: `backend/tests/test_llm_wiki_agent_selection.py` covers selection,
migration, editable instructions, and unavailable models; ingestion recovery and
HTTP contract tests cover existing workflows. The settings controller tests cover
selection before table setup, preserving unfinished edits, and retrying errors.
Header and embedded-view tests cover maintenance routing, configuration guards,
retries, keyboard access, refreshed proposals, and record refresh after review.
