# Directive: System Skills vs Agent Tools Architecture

This directive defines the categorical hierarchy and maintenance standards for the Gnosi functional ecosystem.

> ID: ARCH-SKILL-TOOL-20260408
> Context: Semantic Unification
> Status: ACTIVE

---

## 1. Categorization

### A. System Skills (Strategic Foundations)
- **Location**: `monorepo/apps/gnosi/pipeline/skills/[skill_name]/`
- **Authorship**: Developer (or Senior Agent like Antigravity).
- **Structure**: Multi-file, robust error handling, mandatory `SKILL.md`.
- **Language**: **English** (Standardized).
- **Purpose**: Core business logic, automated pipelines, maintenance, and long-term infrastructure.

### B. Agent Tools (Tactical Capabilities)
- **Location**: `monorepo/apps/gnosi/backend/agent/instructions/` (Instructions) and `monorepo/apps/gnosi/backend/agent/generated_tools/approved/` (Code).
- **Authorship**: Gnosi AI Assistant (GnosiBot).
- **Structure**: Single-file Python scripts, generated on-the-fly.
- **Language**: **Catalan/Spanish** (Conversation) / **English** (Procedural Instructions).
- **Purpose**: Dynamic user requests, single-purpose utilities, experimental features.

---

## 2. Promotion Protocol (The Path to Legend)

When an **Agent Tool** proves to be indispensable or highly reusable, it should be promoted to a **System Skill**:

1. **Refactor**: Move the code from `generated_tools/approved/` to a new folder in `pipeline/skills/`.
2. **Standardize**: Translate any docstrings or internal logic notes to **English**.
3. **Document**: Create a formal `SKILL.md` in English following the SOP pattern.
4. **Integration**: If necessary, register the skill in the Backend system or expose it via MCP.

---

## 3. Maintenance Responsibilities

- **Antigravity (Developer Agent)**: Full owner of `System Skills`. Can audit and refactor `Agent Tools` for promotion.
- **Gnosi Assistant (In-app Bot)**: Primary user and creator of `Agent Tools`. Restricted from modifying core `System Skills` unless explicitly delegated.

---

## 4. Key Rule
> "Agent Tools are the soil; System Skills are the trees. One feeds the other, but they have different growth rates and care requirements."
