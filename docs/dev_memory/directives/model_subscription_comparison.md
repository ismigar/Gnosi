# Provider subscriptions in model comparison

Model catalog tariffs describe token charges, not subscription entitlements.
A remote zero is insufficient evidence of free access. Every comparison route
receives a billing classification and a provider documentation link when present
in the catalog. Verified plan facts are kept in
`backend/data/provider_billing.json`, with exact provider/region IDs, official
sources and review dates. Never copy an international fee to its Chinese route.
Unknown providers and unpublished conversions stay explicit; the UI does not
claim that every provider publishes its token allowance.

The evidence file is a reviewed snapshot, not a live subscription or account
balance lookup. Updating the model catalog does not refresh its verification
date. Facts over 30 days old remain available as dated evidence but cannot
produce equivalent token prices. Maintain the snapshot against the linked
official sources; never infer model rates from a provider's zero catalog entry.
Sources can also establish that a named coding plan has been retired in favor
of metered billing. The package resource allowlist includes this public JSON.

For a monthly fee F and a shared monthly allowance Q, the equivalent input and
output prices per million are F/Q multiplied by the exact model's published
input and output allowance deductions per million tokens. A fixed token quota
uses one million units for each direction. The same allowance covers both
input and output; it is not counted twice. This assumes full use of the entire
allowance by that model, without caching, promotions, tools or other models.
Rates depending on unavailable context tiers, time windows or undisclosed
credit multipliers remain unknown. Weekly quotas are not fabricated into monthly
quotas. Model coverage is checked against an explicit official list when supplied.

Each plan is a distinct offer. For the chosen input/output volume, monthly cost
is the whole subscription fee if its published allowance covers the volume.
It is never the fractional token allocation. Above the allowance, the UI says
the quota is exceeded and does not invent extra subscriptions or top-up prices.
Five-hour/weekly limits can still restrict bursts within a monthly allowance.
The hover/focus asterisk explains the provider, exact model, plan, monthly fee,
quota, formula, limitations, source and date. The minimum fee remains visible.
Provider filters, price sorting and price ceilings use these same offers.
Plans without a token conversion remain visible as subscription requirements;
numeric price filters exclude their unknown prices.

Display money uses the comparison's configured currency and shared USD FX
snapshot. CNY provider fees use a real exchange quote, never the unknown-currency
1:1 fallback. Older FX caches are refreshed to include CNY; if no quote is
available, the original fee/currency remains labeled and no USD equivalence is
invented. Ordinary per-token offers retain their catalog rates; specifically
verified free endpoints retain a zero and their limits disclosure.

These fields are **comparison only**. They do not replace executable registry
tariffs, actual billed costs, reading reservations or spending limits. Reviewing
prices must not activate a model, buy a plan or launch a source-reading job.
Tests use offline plan/FX fixtures and assert fee arithmetic, exact routing,
unknown/stale data, quota overflow, currency conversion and hover/focus behavior.
