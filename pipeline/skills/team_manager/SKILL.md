# SKILL: Team Manager (Multi-Agent Architecture)

This skill manages the infrastructure and collaboration rules of the Gnosi multi-agent team.

> ID: TEAM-MGMT-20260408
> Status: ACTIVE

---

## 1. Team Architecture (LangGraph)
The team operates as a graph of specialists coordinated by a central Supervisor.

### Roles and Responsibilities
- **Supervisor (Director/Alejabot)**: The central brain. Decides which specialist acts. Responsible for team memory in `.antigravity/team/`.
- **Coder (Specialist)**: Specialist in code, files, and Docker. Executes `tasks.json`.
- **Brain (Architect)**: Specialist in data design and systemic architecture.
- **Reviewer (Devil's Advocate)**: Mandatory for QA before task closure.

---

## 2. Operation Protocols (SOP)

### Task Management
1. **Declare**: The Director must declare the current role and task.
2. **Lock**: Before refactoring critical files, a lock must be created in `.antigravity/team/locks/`.
3. **Mailbox**: Asynchronous communication between agents is performed via `.msg` files in `.antigravity/team/mailbox/`. Once processed, messages must be moved to `mailbox/archive/`.

---

## 3. Agent Profiles (Personas)
The agent can adopt various profiles depending on the context:
- **Default/Architect**: Full system overview.
- **Content Creator**: Specialized in articles and Notion connector.
- **Senior Developer**: Specialized in pipeline and Docker.

---

## 4. History and Learning (Learning Cycle)

| Date | Error / Learning | Root Cause | Solution / Refinement |
| --- | --- | --- | --- |
| 2026-03-08 | Context Loss | Session Timeouts | Use of `tasks.json` as persistent state memory. |
| 2026-04-08 | Role Fragmentation | Docs vs Skill | Consolidation of multi-agent architecture into `SKILL.md`. |

---
*Maintenance: If new profiles are added to the supervisor, they must be documented here and `backend/agent/factory.py` must be updated.*
