# Shared Brain source-reading skill

The source button and chat tool both call `llm_wiki_actions.start_source_process`.
The durable worker resolves the same configured processing profile (the existing
managed Brain profile, otherwise the principal agent), activates its assigned
`plugin.llm-wiki.process-source` skill, and freezes the model and effective
persona/context/skill instructions for the complete job. Missing assignments or
unavailable profiles fail explicitly; no unrelated provider or agent is selected.

The authoritative reading policy lives in
`backend/domains/llm_wiki/reading_skill.py`. The plugin catalog publishes this
exact content. Do not add a second set of reading instructions to a button,
chat handler, or the ingestion facade. The worker uses the effective catalog
instructions, including profile persona and inline context. Other profile skills
are not activated implicitly for a source-processing job.

The application supplies mechanical contracts and limits; the skill owns
interpretation, attribution, qualification, classification, cross-reference
requests, and contextual review. The stages are section overviews, hierarchical
global synthesis, atomic extraction, a joint overview of proposed notes, and
contextual review. Both extraction and review can request original passages by
segment id or search query. Context passages support interpretation/citations,
while every note must cite its own primary passage to avoid extracting context
again. Source documents are untrusted evidence, never instructions.

Chunks prefer section/chapter and paragraph boundaries; oversized blocks prefer
sentence/word boundaries. Tables and lists remain intact when they fit. Neighbours
are explicitly context-only. Model context capacity reserves output, framing and
the full skill; UTF-8 byte counts provide a conservative token upper bound without
downloading a tokenizer. Every complete request is checked before provider I/O.
Original text is not silently truncated to meet a budget. Optional Brain link
candidates are bounded; distant originals remain accessible through evidence
requests. Notes are reviewed in bounded batches against the joint overview.

Each phase is checkpointed with source hashes, effective execution revision,
language and exact phase input. Successfully reused checkpoints are copied to the
new job, so another interruption still preserves progress. Reduced write plans
require the full reading revision and completed review; legacy unreviewed plans
must be read again. Writes, PDF annotations and indexes remain application-owned.
Job/manifest reports record agent/model/skill revision, coverage and warnings.
Coverage proves that extracted passages were accounted for, not perfect semantic
comprehension. Exact quotation checks do not prove the correctness of an inference.

Validation uses deterministic model doubles, including late refutation, distant
evidence retrieval, invalid citations, missing coverage, changed instructions,
retry deadlines, repeated interruptions and forced reprocessing. Do not call paid
providers or modify a live vault merely to run these contracts.
