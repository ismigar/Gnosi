# Task-aware model recommendations

The comparator offers task-specific suggestions alongside its catalogue table.
The task panel is the decision aid; the table's legacy role score remains a
general weighted catalogue indicator, not the task panel's quality score.
Seven editable scenarios cover batch classification, structured extraction,
chunked book reading, passage retrieval, coding, multi-step coordination and
complex analysis. Selecting a role scopes the available scenarios. Book
reading defaults to a 0.50 USD equivalent execution budget in the configured
currency. Default token volumes are examples, never measurements of a resource.

Recommendation candidates respect the current provider, search, availability,
mode, parameter, context and numeric price filters. General catalogue role
thresholds and incomplete-row visibility do not hide candidates before the
task's own requirements are checked. Each candidate is an exact provider/model/
subscription-plan offer. Input/output text, required context, structured output
or tools must be declared on that same route. Do not borrow capabilities from
another provider. Documented interactive-only plans are excluded from Gnosi
application/background tasks. Unverified zero tariffs, insufficient allowances,
unknown plan conversions and local hardware costs cannot win a cheapest ranking.

Users enter input/output tokens per execution, per-call context, minimum relative
quality, execution budget and a retry allowance (1–10 total attempts). Tokens
must include instructions, memory and repeated passages. Metered costs multiply
the supplied volumes by attempts; subscriptions charge the full monthly fee
and must cover that volume. The budget filters suggestions only; it does not
change actual runtime spending limits. Search/tool fees and uncounted overhead
remain explicitly unverified. Do not extrapolate synthetic sample cost or time
to a whole book or workflow.

Quality uses task-specific intelligence/coding/agentic indices, ranked against
the entire current feed. These are comparative indicators, not an absolute
probability of success. Context size, speed and tariffs do not raise quality.
Unknown required benchmark indices yield no numerical quality recommendation.
Rank arrays are prepared once, then binary searched to avoid per-offer scans
of the entire catalogue. Equal metrics receive equal mid-ranks.
If one executable route maps to several reasoning benchmarks, use the lowest
known score and its benchmark row, regardless of catalogue order or search
filters. Disclose the number of benchmark variants; the offer alone does not
identify the reasoning setting Gnosi will execute. Do not borrow a maximum
reasoning score for an unspecified or lower runtime setting.
Stored tests do not boost quality when the benchmark configuration is ambiguous.

Stored synthetic role tests contribute 20% only when they match the exact role,
provider and model, protocol synthetic_roles_v1, and are dated within 30 days.
Benchmark guidance contributes 80%; without matching tests it supplies the full
score and is labeled catalogue-only. Any failure in the latest matching test
excludes that offer. Old/future dates, other providers, other roles and strategy
tests must not influence it. Passing 2–3 synthetic tests is not full-task
certification. Real document coverage, citation fidelity, schema accuracy,
tool reliability and uncertainty handling remain stated validation gaps.

The quality option has the highest qualifying estimated score. The economical
option minimizes execution cost above the quality floor. The balanced option
minimizes cost within five quality points of the best. Exact-provider synthetic
mean latency breaks economic ties; no global benchmark latency is substituted
for missing provider measurements. A single offer may satisfy multiple choices.
Excluded offers have explicit counted reasons; an empty result is never replaced
with an invented or unsupported recommendation.

Opening or refreshing reads existing role reports and principal execution
metadata, never invokes models. Reports and run metadata are scoped to the
active vault, aborted on vault changes, and hidden immediately across vaults.
New explicitly authorized laboratory tests refresh recommendations. Available
30-day operational history counts root runs for the exact provider/model and
all operations; missing/paged history is not a complete reliability sample.
Operational completion does not certify output quality or attribute bills of
mixed-model runs. Operational failures are not inferred to be model failures
and do not penalize quality. Neither results nor error details enter the panel.

Offline tests verify provider isolation, retry/budget arithmetic, full fees,
quota overflow, constraints, unavailable evidence, historical state grouping,
synthetic-test freshness and exact matching, quality independence from context/
price/speed, and vault isolation. No tests or recommendations spend API credits.
