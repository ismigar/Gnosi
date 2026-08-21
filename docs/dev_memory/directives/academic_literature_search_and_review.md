# Academic Literature Search and Review

## Status

- Active implementation directive for the Resources academic-search domain.
- Applies to the authoritative Gnosi tree under `monorepo/apps/gnosi`.
- Extends the plugin system, reference manager, durable jobs, vault tables, Notebooks, and AI provider without replacing their existing contracts.

## Purpose

Provide a reproducible, auditable literature-search workflow inside Gnosi. Authenticated users can search permitted academic data sources, preview normalized records, and inspect provenance. Editors can import works into Resources and screen review candidates. Administrators can manage repository definitions, credentials, and synchronization.

The deterministic workflow must remain useful without an AI provider. AI operations are explicit aids for query construction, ranking, screening suggestions, synthesis, and citation expansion. AI never makes final inclusion or exclusion decisions.

## Ownership and persistence

- The `resources` built-in plugin owns the user-facing configuration and the `/literature` workspace.
- `/api/vault/reference-table` remains the only source of truth for the Resources table designation. Plugin settings link to or call that API; they do not duplicate the selected table identifier.
- Repository configuration, saved strategies, run history, candidates, decisions, and audit data belong to the Principal vault so they remain portable and inspectable.
- Reconstructible OAI indexes, FTS data, synchronization cursors, and temporary response caches belong under `LOCAL_DATA` using environment-aware path helpers.
- API keys and contact credentials belong in the operating-system Keychain in native mode or environment variables in Docker mode. They must never be written to the vault, `.gnosi/plugins.json`, logs, or API responses.
- Historical activities keep immutable snapshots of source names and effective public configuration so later repository edits do not rewrite the audit trail.

## Network and licensing policy

- Do not scrape services without an authorized API, OAI-PMH feed, or documented machine-access endpoint.
- Google Scholar and Academia.edu are external links only. They are never selectable automated connectors.
- SJR is a journal metric integration, not a literature repository.
- Every built-in connector documents its official endpoint, authentication mode, quota behavior, and machine-access status.
- Custom repositories require HTTPS. Requests pass through Gnosi's safe HTTP policy with DNS and IP validation, SSRF protection, redirect limits, timeouts, response-size limits, and content-type validation.
- Custom REST connectors are declarative GET/JSON integrations only. They cannot submit forms, execute scripts, upload content, or provide arbitrary headers other than separately stored authorized credentials.
- OAI XML uses a parser that disables entities, DTD expansion, and external resource resolution.
- Robots exclusions, provider terms, `Retry-After`, quotas, and contact-email requirements take precedence over throughput.
- Full-text attachment is always initiated by a human and offered only for a verified open-access location and a recorded license or provider OA assertion. Previewing metadata never downloads a document.

## Built-in source catalog

### Open and enabled by default

- Crossref
- DataCite
- arXiv
- Europe PMC
- ERIC
- OpenAIRE
- HAL
- CORE
- Open Library
- SciELO Articles
- DOAJ Articles

### Enabled when a contact email is configured

- PubMed
- Unpaywall

### Enabled through a local OAI index

- Dialnet Articles
- Dialnet Theses
- DOAB
- SciELO Books

### Visible but disabled until credentials or subscription are configured

- OpenAlex
- Semantic Scholar
- Springer Nature
- Scopus
- Web of Science
- Dimensions

### External access only

- Google Scholar
- Academia.edu

The runtime may mark a source temporarily unavailable, rate-limited, or unsupported without changing the user's stored default. A single source failure must not fail a federated search.

## Canonical work contract

`AcademicWork` is the normalized public contract. It includes:

- stable result identifier;
- title and normalized title;
- structured authors with given name, family name, literal name, and identifiers when available;
- issued, published-online, and published-print dates;
- year;
- abstract and abstract availability;
- canonical document type;
- container title, publisher, volume, issue, and pages;
- language;
- normalized DOI, PMID, PMCID, arXiv identifier, ISBN-13 values, and provider identifiers;
- open-access state, license, best OA location, and all verified locations;
- source occurrences;
- citation metrics grouped by provider;
- field-level provenance and conflicting variants;
- deterministic duplicate key and possible-duplicate indicators;
- Resources membership state and existing resource identifier when known.

`SourceOccurrence` keeps provider identifier, provider record identifier, original URL, provider score, provider citation count, retrieved timestamp, and the raw public metadata subset required for provenance. It never includes secrets or unrestricted full response bodies.

## Deduplication

Automatic unions use the first available deterministic rule in this order:

1. normalized DOI;
2. PMID or PMCID;
3. arXiv identifier without a version suffix;
4. validated ISBN-13;
5. exact normalized title plus year plus normalized first-author family name.

Title normalization is Unicode-aware, case-folded, punctuation-insensitive, and whitespace-collapsed. DOI normalization removes resolver prefixes and surrounding punctuation. ISBN validation includes the ISBN-13 check digit.

Fuzzy similarity only marks a possible duplicate. It never merges records automatically.

Merged records preserve every source occurrence, identifier, and location. Canonical fields are selected by a documented provider priority plus completeness and specificity. Conflicting values remain visible with field-level provenance. Citation counts from different providers remain separate and are never summed as if directly comparable.

Import repeats deterministic deduplication against Resources inside an atomic per-vault lock. A matching resource returns the existing record and marks the operation as idempotent. Citation-key generation and typed-template selection are shared with identifier import rather than reimplemented in the literature UI.

## Search lifecycle

- A search stores the original query, structured filters, selected sources, exact translated query per source, start and completion timestamps, errors, counts, and user-visible snapshots.
- The exact-query audit stores the connector version, provider syntax, and the
  effective public request parameters actually used. Never reconstruct these
  values in the frontend from the original query.
- Search counters distinguish raw provider occurrences, deterministic unions,
  fuzzy warnings, and final unique works. These counters feed review activities
  and PRISMA duplicate-removal totals.
- Search creation returns immediately with an identifier.
- Connectors execute independently and emit progressive source-status and result events through SSE.
- The frontend consumes SSE with cursor replay and falls back to bounded
  polling. Search state and paginated results remain retrievable without SSE so
  reconnecting clients can resume.
- Cancellation prevents new connector work and closes pending tasks where the client permits it. Completed partial results remain available.
- Rate limits, authentication failures, parse errors, and provider outages are recorded per source and do not turn a partially successful search into a global failure.
- Result ordering has an immutable deterministic order. Optional semantic reranking adds a separate rank and explanation without hiding the original order.

## Custom repositories

OAI-PMH definitions include a name, HTTPS base URL, metadata prefix, optional sets, synchronization mode, tombstone handling, and public attribution URL. Full and incremental harvests persist resumption tokens and datestamps and are restart-safe.

Declarative REST definitions include a name, HTTPS URL, query parameter or URL template, static filters, pagination mode, maximum page size, response list path, and canonical JSON-field mappings. Supported pagination modes are page, offset, cursor, RFC Link, and none.

Deleting a custom definition requires confirmation. The user may retain or delete its local index. Search and review histories retain source snapshots in either case.

Sandbox plugins may contribute complex adapters through optional `contributes.academicRepositories` metadata compatible with plugin API v2. Adapters require `network` permission, use Gnosi's safe HTTP client, and return the canonical normalized contract. Plugin adapters cannot bypass credential storage, SSRF checks, or response limits.

## OAI synchronization

- SQLite with FTS5 under `LOCAL_DATA` stores reconstructible records and repository state.
- The durable job type is `academic_repository_sync`.
- Full harvests are resumable using the latest committed resumption token.
- Incremental harvests use the last successful provider datestamp with a safe overlap window and deterministic upserts.
- Deleted records and OAI tombstones remove the searchable record while retaining synchronization audit counts.
- Progress reports repository, phase, received count, indexed count, deleted count, last datestamp, and estimated completion only when the source provides enough information.
- Jobs can be cancelled and retried. A cancelled or failed job never advances the last-successful synchronization marker.
- The first harvest is an explicit administrator action because large repositories can contain hundreds of thousands of records. A new installation must not start it automatically.
- After a repository completes its first harvest, a daily incremental scheduler enqueues it when due without assuming native or Docker paths.

## Managed review tables

Creation is idempotent in the Principal vault and uses stable managed-table identifiers:

- `Literature Reviews`: question, protocol, eligibility criteria, reviewer mode, assigned reviewers, status, source configuration, and timestamps.
- `Literature Activities`: append-only versioned strategies, executions, exact per-source queries, source errors, counts, AI operations, schedules, and exports.
- `Literature Candidates`: one deduplicated work per review with source snapshot, identifiers, phase, full-text state, Resources relation, and timestamps.
- `Literature Decisions`: append-only reviewer decision per phase, reason, notes, timestamp, and optional replaced-decision relation.

Review phases are identified, title/abstract screening, full text requested, full text assessed, included, and excluded.

In individual mode, the latest non-replaced human decision advances the candidate. In dual-blind mode, each reviewer's current decision remains hidden from the other reviewer until both have decided. Matching decisions advance the candidate; disagreements enter conflict resolution. Resolution is an explicit human decision with its own audit row. Prior decisions are never edited or deleted.

Dual-blind reviews have exactly two assigned reviewers. The creator occupies one slot and must name one distinct second reviewer; silently accepting extra reviewers produces an ambiguous release condition and is not allowed.

Saved strategies are versioned. Scheduled updates create a new activity, run the stored version, deduplicate against existing candidates, and flag only newly discovered works. Citation and reference snowballing records the seed, direction, provider, and resulting candidates.

## Audit and PRISMA exports

Exports are deterministic and generated from immutable activity and decision records:

- candidates and decisions CSV;
- complete audit JSON;
- Markdown review report;
- printable PRISMA 2020 SVG.

PRISMA counts identify database/register records, duplicate removals, screening exclusions, reports sought, reports unavailable, full-text exclusions with reasons, and included studies. Generated SVG is escaped, contains no scripts or external resources, and remains usable without the frontend.

Exclusion reasons are required for human exclusions. Full-text state changes
are explicit human actions and record whether a verified open-access location,
an attached Resource, or an unavailable report supports the state. Do not infer
full-text assessment merely from an open URL.

## AI assistance

- AI controls are opt-in per operation.
- Query assistance extracts editable PICO or SPIDER concepts, multilingual synonyms, variants, and Boolean proposals.
- Source translation returns editable exact syntax for each connector.
- Accepted source translations are persisted separately from the shared query,
  executed only for their matching connector, and included in scheduled strategy
  versions and request audit.
- Semantic reranking retains and exposes deterministic rank.
- Screening suggestions include inclusion/exclusion/uncertain, rationale, confidence, and evidence scope. They do not write a human decision or advance a phase.
- Synthesis uses only explicitly selected works and labels whether evidence came from title, abstract, metadata, or verified full text.
- Snowballing suggestions distinguish retrieved citation metadata from model-proposed queries.
- Deterministic backward and forward snowballing runs before optional AI:
  retrieve citation metadata from authorized provider APIs, preserve the seed
  and direction, deduplicate returned works, and require a human to add them as
  candidates.
- Every AI activity records provider, model, timestamp, token or usage estimate, cost when supplied, evidence level, selected resource identifiers, and prompt-operation version.
- Pre-search AI operations travel into the persisted search audit when the
  search starts. Post-search operations append their server-produced audit to
  that same history item; the frontend must not reconstruct model or cost data.
- Missing providers, model errors, and cost-limit refusals return a safe user-visible error while deterministic search and review continue.
- Local embeddings are preferred for zero-cost reranking when available and must follow the current architecture-specific dependency constraints.

## API and authorization

All new routes live under `/api/vault/literature` and reuse authenticated vault dependencies.

- Authenticated users: read catalog and configuration, search, receive events, inspect results, preview works, and read reviews they can access.
- Editors: import one or more works, create or update reviews, add candidates, submit screening decisions, resolve assigned conflicts, and send imported resources to Notebooks.
- Administrators: create, test, edit, hide, restore, or delete repositories; update credential references; start, cancel, or resume synchronization; and manage global defaults.

Mutating endpoints use existing CSRF and authorization conventions. Public API responses never return secret values. Credential status is represented only as configured, missing, invalid, or environment-managed.

## User interface

- Register the built-in `resources` plugin and enable it by default.
- Add its configuration panel to plugin settings and keep the former References setting as a direct link into this panel.
- Add Literature Search to the sidebar and every Resources table view.
- The search form supports Boolean text, dates, language, document type, peer-review, open-access, and per-search source selection.
- Results arrive progressively and show provider status without moving already reviewed items unexpectedly.
- Every deduplicated result shows source badges and occurrence count, authors, year, publication, abstract, identifiers, OA state, provider-specific citation counts, Resources membership, `View`, and `Add to Resources`.
- `View` opens a metadata panel with variants, field provenance, OA locations, and original links. It does not store or download a file.
- Multi-selection supports batch import and then sending successfully imported Resources to a Notebook.
- Review views support saved strategies, candidate queues, blind screening, conflict resolution, audit history, exports, and accessible keyboard operation.
- OAI source settings expose live received/indexed/deleted counts, incremental
  synchronization, full reindexing, cancellation, and resumption.
- Every user-facing string exists in Catalan, English, Spanish, and French locale catalogs.

## Restrictions and edge cases

- Do not automate Google Scholar or Academia.edu; this would violate the machine-access policy. Use an external search link instead.
- Do not store indexes in the vault; large reconstructed data would harm synchronization and portability. Use `LOCAL_DATA` and preserve only audit snapshots in the vault.
- Do not persist secrets in repository definitions; vault exports could expose them. Store credential handles only.
- Do not infer peer-review status from publication type alone. Use provider evidence or mark it unknown.
- Do not claim a work is open access from an unverified arbitrary URL. Require a provider OA assertion or Unpaywall location.
- Do not merge fuzzy-title matches. Show them as possible duplicates requiring human review.
- Do not hide partial-source errors. Preserve them in search status and activity audit.
- Do not reveal a dual-blind reviewer's decision before the second decision exists. Server responses enforce blindness; frontend hiding alone is insufficient.
- Do not advance candidates from AI suggestions. Only human decision records change screening phase.
- Do not state that AI read full text unless a verified full-text source was explicitly attached to the operation.
- Do not hard-code native paths or Docker hostnames. Use `LOCAL_DATA` and environment-aware helpers.
- Do not advance OAI cursors on failed or cancelled jobs. Resume from the last committed token or last successful datestamp.
- Do not delete historical source snapshots when a repository is removed. Only its reconstructible index may be deleted.
- Do not report PRISMA duplicate removals as zero when originating searches
  merged occurrences. Persist and aggregate measured counters instead.
- Do not label a source query as exact when it is only the shared user query.
- Do not apply one provider-specific AI translation to every connector. Store
  and execute it by source identifier, while retaining the original query.
- Do not index an arbitrary URL as verified full text. Manual capture may reuse
  the identifier lookup service for metadata, but attachment and OA verification
  remain explicit later actions.
- Do not implement citation expansion by scraping result pages. Use authorized
  Semantic Scholar references/citations or OpenAlex referenced-works/cites APIs,
  and require human selection before creating candidates.
- Do not make Docker CI depend on an interactively provisioned runner binary or
  blocking sudo cleanup. Install a pinned, checksum-verified full nerdctl
  bundle in the runner tool cache, start the official rootless containerd and
  BuildKit services when absent, and fail with their service logs if startup
  cannot complete. Installing only the client still leaves builds without a
  daemon. On Ubuntu runners that restrict unprivileged user namespaces, load a
  path-scoped AppArmor profile for the checksum-verified RootlessKit binary
  with non-interactive sudo; never disable the host-wide restriction.
- Do not import the monolithic vault API route module from a literature service
  to resolve plugin paths or state. It initializes unrelated subsystems and can
  make catalog requests exceed the frontend timeout. Read the requested vault's
  `.gnosi/plugins.json` through a small service-level helper instead.
- Do not give the isolated live-E2E backend only a short fixed startup window
  on the ARM64/QEMU runner. A cold import after the full backend suite can take
  more than 100 seconds. Poll the process with a bounded multi-minute deadline
  and print its captured log on early exit, timeout, or E2E failure.

## Verification requirements

Backend verification covers canonical normalizers, identifier normalization, deterministic and fuzzy duplicate behavior, connector quotas and retries, partial failures, search cancellation, SSE replay, OAI resumption tokens and tombstones, restart-safe jobs, SSRF and XML defenses, atomic import, managed tables, blind decisions, conflicts, AI audit boundaries, and PRISMA counts.

Frontend verification covers plugin configuration, repository lifecycle, per-search source toggles, progressive result rendering, duplicate provenance, preview, single and batch import, existing-resource state, Notebook handoff, saved strategies, blind screening, conflict resolution, exports, keyboard navigation, and all locale keys.

E2E uses deterministic mocked connectors and limited live smoke calls to Crossref, Europe PMC or PubMed when configured, DataCite, and the first Dialnet OAI page. Live tests must use small limits and respect provider contact and quota rules.

Release validation includes backend tests, frontend tests and lint, `npm run build`, native runtime smoke checks, Docker build/smoke validation, real browser DOM inspection and screenshots at `https://localhost:5173`, and two successful documentation-gate runs with no generated diff after the second run.
