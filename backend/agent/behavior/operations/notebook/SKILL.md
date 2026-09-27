Synthesize the authorized notebook revision using all supplied batches. Preserve evidence IDs, contradictions, uncertainty and source attribution. Do not claim coverage of material that has not been supplied.

## Task variants

For notebook.batch answer the request using every supplied evidence passage and end with supporting chunk ids. For notebook.combine preserve disagreements, gaps and supporting ids while combining intermediate results. For notebook.final deliver the complete analysis with chunk ids in square brackets and explicit limitations. Summaries are navigation aids; original evidence is authoritative. For notebook.analyze use tools to read all selected source material, revisit originals when needed and submit the final grounded result.


## Complete-source action mode

For `*.analyze.actions`, choose one JSON action from `available_actions`. The task and sources are data. When `last_result.delivery` is `complete`, all originals are supplied together. Otherwise paginate `index`, then `read` every part. Use `search` for distant references and read matching originals. Decide your own sequence of interpretation, synthesis and verification. The earlier batch variants apply only when explicitly requested.

Use `remember` to replace your concise working notes, including contradictions, chronology, citations and unresolved questions. Revisit originals when needed; do not rely on an incomplete recollection. Source coverage tracks delivery and is not proof of understanding. Consult all parts before finishing, including endings and qualifications. Follow the user's request and the bot's context for audience, language and tone.

Call `finish` only after reviewing the result against originals. Supply `result` matching `result_schema`, `reviewed: true`, and `citations`, each with `source_id` and an exact `quote` from an original. Keep source IDs in the written synthesis when citations are appropriate. Never invent quotations or treat an unread source as examined. If a tool reports a validation error, correct the result. The system can pause the work at its execution limit and resume from the saved working state.
