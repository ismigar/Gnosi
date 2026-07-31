# Directive: Agent table title replacements

## Objective

Route multilingual requests that inspect or update Gnosi table rows to the
Vault-capable Brain specialist, so it can use the governed table tools instead
of replying as if it cannot access the Vault.

## Procedure

1. Recognize Catalan, Spanish, and English references to tables and row-title
   replacements as Vault/tool intent.
2. Route that intent to Brain when the legacy tool bundle is active.
3. Assign the first-party Vault skill to the managed LLM Wiki profile, including
   a migration from its previous default skill list.
4. Keep changes governed: inspect source and target rows first, then prepare
   one bulk-update confirmation with the exact affected rows.
5. Cover the reported title-replacement wording with a regression test.

## Restrictions / Edge Cases

- Do not route ordinary prose containing a generic project or area reference
  solely because it contains a table-related word; require a table/data action
  term or an explicit Vault-table reference.
- Do not write rows immediately. Bulk table updates must remain pending until
  the user confirms the generated preview.
- Do not claim that the Vault is inaccessible when the Brain tool bundle is
  available; inspect the tables through the registered tools first.
- Do not run backend tests without `GNOSI_LOCAL_DATA` in a native shell,
  because the legacy Docker fallback is `/app/data` and test collection can
  fail before the Vault fixtures run. Use an isolated temporary local-data
  directory instead.

## Verification

Run the focused agent-runtime tests, the relevant tool tests, the backend test
suite subset, the frontend production build, and browser QA against the native
service.
