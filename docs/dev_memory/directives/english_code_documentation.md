# Directive: English Code Documentation

## Objective

**All documentation embedded in source code — comments and docstrings — MUST be written in English.**

Gnosi is free software published on GitHub (AGPL-3.0-or-later). Contributors and users
who clone the repository come from anywhere; English is the lingua franca of the codebase.
Catalan/Castilian belongs in two places only: (1) the conversation with the maintainer,
and (2) user-facing product content that reaches end users through the i18n system. The
code itself — the part a stranger reads to understand or extend Gnosi — is documented in
English.

> This does **not** change how the agent talks to the maintainer (Catalan/Castilian) nor
> the product's multilingual UI. It governs the *language of the source-level documentation*.

## Scope — what to translate

Translate to natural, professional English:

- **Comments** — Python `#`, JS/TS `//`, block `/* … */`, JSDoc `/** … */`.
- **Docstrings** — Python `"""…"""` / `'''…'''` (module, class, function), keeping
  Google-style structure (`Args:`, `Returns:`, `Raises:`).
- **Inline TODO/FIXME/NOTE/HACK** notes written in Catalan/Castilian.

## Restrictions / Edge Cases — what to NEVER touch

Changing any of the following risks breaking behaviour, tests, or the product. Leave them
**exactly** as they are:

1. **User-facing string literals** — labels, messages, placeholders. These are localized
   through the i18n system (translation keys), not by editing the source string. See
   [gnosi_settings_and_i18n.md](gnosi_settings_and_i18n.md) and the `i18n_hardcoded_ui_strings`
   directive.
2. **i18n keys and translation catalogs** — never rewrite keys or locale values.
3. **Identifiers** — variable, function, class, file, route, and DB-column names, even when
   they are Catalan/Castilian (e.g. `autoria`, `bitacora`). Renaming them is a separate,
   reference-aware refactor, out of scope for a documentation pass.
4. **Test fixtures and expected data** — Catalan/Castilian strings that a test asserts on.
   Translating them makes the test fail.
5. **Log / exception message strings** — leave string literals alone by default. A comment
   *about* a log line is translated; the logged string itself is not (tests and dashboards
   may match on it). Only translate a log string when you have verified nothing asserts on it.
6. **Regexes, URLs, file paths, sample content, prompt templates** sent to an LLM or an
   external API.
7. **Code semantics and formatting** — do not reflow code, change indentation, reorder
   imports, or alter comment markers/quote styles. A documentation pass is a *text-only*
   edit inside comment/docstring spans.

When in doubt whether a Catalan/Castilian string is documentation or content: if removing it
would change what a *user* sees or what a *test* checks, it is content — leave it.

## Procedure

1. **Inventory** — scope which files carry non-English documentation (not just any non-ASCII
   character, which over-counts UI strings). Use `pipeline/scripts/scope_code_docs.py` (walks the
   tree, uses Python `tokenize`/`ast` and a JS/TS comment scanner to separate comments &
   docstrings from string literals). It reports, per file, `comment_hits` / `docstring_hits`
   / `string_hits`. Target files with `doc_hits > 0`.
2. **Translate** — edit only the text inside comment/docstring spans. Preserve markers,
   indentation, and surrounding code byte-for-byte. Keep technical terms and referenced
   identifiers verbatim (e.g. "the `vault_id` cookie", not "the identifier-of-the-vault").
3. **Verify syntax** — `python3 -m py_compile <files>` for Python; `npm run lint` /
   `npm run build` for the frontend. A documentation edit must never break the build.
4. **Re-measure** — re-run the scoping script. `doc_hits` for translated files should fall to
   ~0. Residual hits are legitimate (proper nouns, accented sample data inside comments) or a
   miss to fix.

## Detection & verification — lessons from the initial migration (2026-07-10)

Detecting *which* comments are Catalan/Castilian is the hard part; word-lists have recall
gaps. What worked, in order of reliability:

- **Elisions are the strongest signal.** `l'`, `d'`, `s'`, `n'` + letter (`l'estat`,
  `d'aquest`) never occur in English and catch what verb-lists miss. Scan for these first.
- **Accented letters** (`à`, `é`, `ç`, `ñ`) signal language; accented symbols
  (`→`, `—`, `·`) do not. <!-- @language-example -->
  don't flag an English comment just because it contains an arrow or a proper noun (`Softcatalà`).
- **Homographs poison word-lists**: `sense`, `cap`, `mes`, `camp`, `workspace`, `events`,
  `cite` are Catalan AND English. Score Catalan-vs-English; never flag on a homograph alone.
- **A JS comment scanner MUST understand regex literals and template strings.** A naive
  string-state machine treats `/['"]/` or an apostrophe in JSX text (`l'API`) as a string and
  then silently skips the following comments — under-extracting in exactly the regex-heavy
  files. This mis-extraction once spliced a translation into **JSX user-facing text**
  (ApiTokensSettings.jsx); it was caught only by token-diffing, not by the naive checker.

**Verify with a real parser, not the same naive scanner that did the extraction:**

- **Python** — `tokenize`/`ast`: compare the token stream excluding COMMENT tokens and
  docstring STRINGs; it must be identical old-vs-new. Robust.
- **JS/TS** — `espree.tokenize` (bundled with ESLint): compare non-comment tokens old-vs-new.
  CSS comments inside `<style>` template literals legitimately change the template-string
  token — verify those by hand. `npm run build` + `npm run lint` (parity vs HEAD) is the
  structural backstop.

## Style

- Natural, idiomatic English — translate the *meaning*, not word-for-word.
- Keep it concise; match the surrounding comment density. Do not add commentary that was not
  there.
- Preserve Google-style docstring sections and any Sphinx/typing hints.
- Comments that are already English stay untouched.

## For external contributors

The policy is stated in [CONTRIBUTING.md](../../../monorepo/apps/gnosi/CONTRIBUTING.md)
("Coding conventions → Language"). New code must be documented in English from the start.

## Related Files

- `pipeline/scripts/scope_code_docs.py` — the inventory / progress-measurement tool.
- `monorepo/apps/gnosi/CONTRIBUTING.md` — external-facing statement of the policy.
- `docs/dev_memory/directives/gnosi_settings_and_i18n.md` — how user-facing text is localized
  (the boundary of what this directive does *not* touch).
