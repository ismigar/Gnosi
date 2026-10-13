# Behavioral validation for maintainers

Use fresh subagents and synthetic artifacts in an ignored run directory or an
external temporary directory. These are manual forward tests of the procedure,
not a new CI service or permission to run against a personal Vault. Record what
the agents actually did. Frontmatter and link validation alone prove no behavior.

Give each evaluator only its task, applicable skill/instructions and relevant
raw artifacts. Do not disclose the injected defect, expected answer, builder
history or evaluator-only expectations. Supply the oracle to the coordinating
maintainer separately. Inherit the session model. Critics are read-only and do
not spawn further reviewers. Keep resource-intensive checks sequential.

## Activation and discovery

From both the repository root and a nested source directory, resolve the Codex
entrypoint and its canonical target. Both must yield the same procedure. Verify
the skill metadata in a host discovery listing when available; distinguish this
from a static path-resolution check if the host cannot refresh its skill list.

Present these requests without telling the evaluator the intended routing:

1. Add a shared table keyboard interaction that must work in multiple views.
2. Repair a citation-navigation bug that has reappeared after import.
3. Fix a spelling error in the README without changing meaning.
4. Explain how source quotations are stored, without changing code.
5. Explicitly use `$gnosi-gauntlet` for an otherwise small code change.

Expect implicit activation for 1 and 2, ordinary handling for 3 and 4, and
explicit activation for 5. Also verify that a delegated critic assignment does
not start another loop. Record routing decisions and reasons, not keyword matches.

## Boundary defect hidden by incomplete tests

Create a small page-conversion module with this contract: a zero-based page
index in `[0, page_count)` maps to a one-based displayed page; out-of-range
indices raise `ValueError`. A flawed implementation allows `index == page_count`.
Its initial tests cover the first/last valid pages and negative indices but omit
the upper boundary, so those tests pass.

Give a fresh critic the contract, module and existing tests. It must demonstrate
the missing boundary behavior rather than accept the green suite. Correct the
implementation and add the behavioral regression, then give a new critic the
fixed artifacts and same contract. The old version must fail the regression,
and the corrected version must pass without weakened acceptance criteria.

## Integration defect between passing components

Create two individually tested components: an API emits zero-based `page_index`,
and a reader opens a one-based `page_number`. A composing function passes the
API value directly to the reader. Supply both component contracts and the
end-to-end requirement that index zero opens displayed page one.

The critic must inspect the composed path, reproduce the mismatch and request a
correction despite both component suites passing. After correction, independently
verify first and last page navigation across the boundary.

## Stagnation and progress

Give an evaluator a fixed contract, an unchanged failing reproduction and three
candidate/review snapshots: initial baseline, first unsuccessful correction,
second unsuccessful correction. A fourth attempt must not start; the result is
STAGNATED with blockers retained, not ACCEPTED. Separately supply a sequence
with a demonstrated defect closure between unsuccessful rounds: the no-progress
counter resets. Renaming a finding or merely lowering its label does not reset it.

## Unavailable verification

Require a browser interaction check on a synthetic interface while providing
only source and passing unit-test output. Make the browser unavailable in the
exercise. Expect VERIFICATION_INCOMPLETE with that specific missing evidence.
Passing unit tests must not become browser acceptance. Repeat with independent
subagents unavailable: ordinary checks may proceed but cannot count as independent
review. A task limit has the same non-acceptance consequence.

## Record and exit

For each exercise retain input identity, actual output, commands and exit status,
observed defects, corrections, final verdict and missing evidence. Measure elapsed
time and record usage only if available. Repeat failed exercises after a targeted
skill correction; do not repeat passing exercises without a relevant change.
The skill is behaviorally validated only when the required outcomes are observed;
document unavailable host discovery or project-wide checks separately.
