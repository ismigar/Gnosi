# Playwright E2E Setup — Pointer

> **Status**: Consolidated as Skill.
>
> The full SOP, architecture, restrictions, and tooling have been promoted to:
>
> **`monorepo/apps/gnosi/pipeline/skills/playwright_e2e/SKILL.md`**

This staging directive remains as a pointer for discoverability. For:

- **Setup**, **commands**, **architecture decisions** → see the Skill (§1–§5).
- **Restrictions / edge cases** (Vite saturation, i18n, mock LLM) → Skill §6.
- **Cross-platform baselines** → Skill §7.
- **Git hooks integration** (pre-commit, pre-push) → Skill §8.
- **CI workflow** → Skill §9.
- **IDE integration** → Skill §10.

## Quick links

- Skill: [`pipeline/skills/playwright_e2e/SKILL.md`](../../../monorepo/apps/gnosi/pipeline/skills/playwright_e2e/SKILL.md)
- Scripts: [`pipeline/skills/playwright_e2e/scripts/`](../../../monorepo/apps/gnosi/pipeline/skills/playwright_e2e/scripts/)
- Test project: [`apps/gnosi/e2e/`](../../../monorepo/apps/gnosi/e2e/)
- CI workflows:
  - [`e2e.yml`](../../../monorepo/.github/workflows/e2e.yml) — runs on push/PR
  - [`e2e-update-baselines.yml`](../../../monorepo/.github/workflows/e2e-update-baselines.yml) — manual, regenerates Linux baselines

## Why kept

The Self-Correction Protocol (CLAUDE.md §3) says directives in `docs/dev_memory/directives/` either consolidate into a Skill or remain as architectural pointers. This file is now a pointer — its content has moved.
