# DIRECTIVE: RELEASE_VERSION_AND_WORKFLOW_INTEGRITY

> ID: 2026-09-04-release-version-workflow-integrity
> Associated Checks: backend health/OpenAPI and root workflow contracts
> Last Update: 2026-09-04
> Status: ACTIVE

---

## 1. Objectives and Scope

- Keep the public FastAPI/OpenAPI version equal to every distributable Gnosi
  manifest for the complete 3.0 release line.
- Reject ambiguous GitHub workflow mappings before a candidate reaches a
  self-hosted runner.
- Regenerate every derived API artifact whenever the public OpenAPI metadata
  changes.

## 2. Inputs and Outputs

- Inputs are `pyproject.toml`, the root, frontend and desktop manifests, the
  FastAPI application and every YAML workflow under `.github/workflows`.
- Outputs are a single matching release version, parseable workflows with
  unique mapping keys, deterministic OpenAPI, its recorded digest and the
  generated TypeScript client.

## 3. Logical Flow

1. Read the Python and Node release identities.
2. Construct the application without starting workers or reading user data.
3. Require its public version to equal every release manifest.
4. Compose every workflow as a YAML node tree and reject a repeated key in any
   mapping, including nested job steps.
5. Regenerate OpenAPI, its digest and the TypeScript client.
6. Run focused contracts, API drift checks and the normal static gates.

## 4. Restrictions and Edge Cases

- Do not obtain the runtime version by reading repository files at application
  startup; packaged desktop installations do not have a source checkout.
- Do not rely on a permissive YAML parser alone. A repeated key can be accepted
  by keeping only its last value, while GitHub may reject or misinterpret the
  workflow.
- Note: do not patch only the committed OpenAPI JSON, because that leaves the
  application and generated client out of sync. Change the application owner,
  regenerate all derived artifacts and review the diff instead.
- Note: do not treat the release tag input as the application version. A release
  candidate suffix identifies an artifact set while the product version remains
  the manifest version.

## 5. Verification

- Focused application-version and workflow-uniqueness tests.
- Deterministic OpenAPI and generated-client drift checks.
- Ruff, strict backend type-check, frontend type-check and production build.
- The complete self-hosted CI matrix before producing release artifacts.

## 6. Learning Log

| Date | Error Detected | Root Cause | Solution |
| --- | --- | --- | --- |
| 2026-09-04 | Gnosi manifests declared 3.0.0 while FastAPI/OpenAPI declared 0.2.0 | The API version remained an old literal outside release consistency checks | Make the runtime identity 3.0.0 and enforce equality against every manifest |
| 2026-09-04 | A release workflow was suspected of containing a repeated `with` key | Ordinary parsing and source inspection did not provide a repository-wide regression gate | Compose every workflow and reject repeated keys recursively before CI |
| 2026-09-04 | Focused tests did not start inside the restricted workspace | `uv` inspected its global source cache outside the repository boundary | Re-run the unchanged frozen environment with controlled cache access; do not create a second environment or resynchronize dependencies |
| 2026-09-04 | Seven desktop policy cases rejected the intentional Docker cleanup | The release guard treated every `if: always()` as a validation bypass, including the final resource cleanup added to keep the self-hosted runner usable | Permit `always()` only for the exactly named Docker cleanup step; keep it forbidden for every validation, job and other step, and keep cleanup failure fatal |
