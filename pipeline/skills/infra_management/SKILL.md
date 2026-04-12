# SKILL: Infrastructure Management

This skill manages the development ecosystem and continuous deployment (CI/CD) of the Gnosi monorepo.

> ID: INFRA-MGMT-20260408
> Status: ACTIVE

---

## 1. GitHub Actions Maintenance (CI/CD)

Protocol for workflow correction (`.github/workflows/*.yml`):
- **YAML Syntax**: Duplicate keys are prohibited (e.g., `path` in `upload-artifact`).
- **Indentation**: Strict 2 spaces.
- **Secrets**: Never expose credentials; use `${{ secrets.VAR }}`.
- **Validation**: Before pushing, validate syntax if there are changes in the build logic.

---

## 2. Repository Organization

Rules for maintaining order on GitHub:
- **Branches**: Protect `main`. All improvements must be created in feature branches.
- **Commits**: Follow the conventional commits standard (`feat:`, `fix:`, `docs:`, `chore:`).
- **Submodules**: For MCP packages, ensure that `package.json` reflects the correct version before publishing.

---

## 3. History and Learning (Learning Cycle)

| Date | Error / Learning | Root Cause | Solution / Refinement |
| --- | --- | --- | --- |
| 2026-02-15 | YAML Duplicate Key | Poorly formatted `.yml` workflow | Use of multi-line strings and GitHub Actions schema validation. |
| 2026-04-08 | Doc Disorder | Floating infrastructure | Consolidation of GitHub protocols into `infra_management`. |

---
*Maintenance: Any change in the automatic deployment policy to the production server must be documented here.*
