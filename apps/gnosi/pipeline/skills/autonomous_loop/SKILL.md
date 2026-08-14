# SKILL: Autonomous Loop (Orchestration)

This skill enables Antigravity and background agents to orchestrate complex task lists without constant human supervision.

> ID: AUTONOMOUS-LOOP-20260412
> Status: ACTIVE

---

## 1. Principles
- **State-Driven**: All logic depends on `.antigravity/team/tasks.json`.
- **Atomic Operations**: Each task must be a discrete unit of work.
- **Verification First**: No task is closed without a "Reviewer" validation.

---

## 2. Components
- **Orchestrator**: `monorepo/apps/gnosi/pipeline/brain/orchestrator.py`.
- **Harness**: The `monorepo/apps/gnosi/pipeline/sandbox/` environment.
- **Memory**: The `docs/dev_memory/directives/` SOPs.

---

## 3. Standard Operating Procedure (SOP)

### How to trigger a loop
1. **Define Tasks**: Manual or automatic creation of items in `tasks.json`.
2. **Launch Orchestrator**:
   ```bash
   python monorepo/apps/gnosi/pipeline/brain/orchestrator.py
   ```
3. **Monitor**: Check `monorepo/apps/gnosi/pipeline/.tmp/orchestrator.log`.

### Self-Correction Protocol
If the orchestrator encounters a "FAILED" status:
1. It applies the **Learning Cycle**.
2. It attempts to patch the failing script or directive.
3. It retries the task once before flagging it for human attention.

---

## 4. History
| Date | Change | Reason |
| --- | --- | --- |
| 2026-04-12 | Initial Implementation | Requirement for autonomous multi-agent orchestration. |
