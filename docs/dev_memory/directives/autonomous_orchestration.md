# DIRECTIVE: AUTONOMOUS_ORCHESTRATION

> ID: 20260412
Associated Script: monorepo/apps/gnosi/pipeline/brain/orchestrator.py Last Update: 2026-04-12
Status: ACTIVE

---

## 1. Objectives and Scope

- **Main Objective:** Establish a deterministic and autonomous execution loop for the Gnosi multi-agent team.
- **Success Criteria:** The orchestrator can autonomously transition tasks from "TODO" to "DONE" by delegating to specialized scripts, verifying output, and handling retries/errors.

## 2. Input/Output (I/O) Specifications

### Inputs
- **State File:** `.antigravity/team/tasks.json` (Required).
- **Environment Variables:**
    - `OPENAI_API_KEY` or `GEMINI_API_KEY`: For agent decision-making.
- **Mailbox:** `.antigravity/team/mailbox/*` (Optional, as async triggers).

### Outputs
- **Task Updates:** Modified `tasks.json` with results and logs.
- **Execution Logs:** `monorepo/apps/gnosi/pipeline/.tmp/orchestrator.log`.

## 3. Logical Flow (Algorithm)

1. **Initialization:** Load `tasks.json` and validate the schema.
2. **Task Selection:** Identify the first task with status "TODO" or "WAITING".
3. **Routing:**
    - Match `assigned_role` to a known Specialist script or LLM prompt.
    - If no script exists, trigger "Architect" session to generate one in `sandbox`.
4. **Execution:**
    - Create a `lock` in `.antigravity/team/locks/`.
    - Execute the task script via `subprocess`.
    - Capture stdout/stderr and exit code.
5. **Validation (Reviewer):**
    - Trigger "Reviewer" role to verify the output against "Success Criteria".
    - If validation fails, transition task to "RETRY" and apply "Self-Correction Protocol".
6. **Completion:** Update `tasks.json` status to "DONE" and remove `lock`.
7. **Bucle:** Repeat until no pending tasks or global timeout reached.

## 4. Tools and Libraries

- **Python:** `json`, `subprocess`, `pathlib`, `time`.
- **Infrastructure:** `.antigravity/team/` filesystem.

## 5. Restrictions and Edge Cases

- **Recursion Depth:** Limit retries to 3 per task to avoid infinite loops.
- **Safety Gate:** Any command affecting the project root outside `sandbox` MUST be explicitly logged and, in strict mode, require manual intervention in `mailbox`.
- **Zombies:** If an agent script hangs beyond `timeout_seconds`, the orchestrator must terminate it and mark task as "FAILED".

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 2026-04-12 | Placeholder Plist | Scripts from plists were missing | Ensure orchestrator can handle "MissingScriptError" by calling Architect. |

## 7. Examples of Use

```bash
# Start the autonomous loop
python monorepo/apps/gnosi/pipeline/brain/orchestrator.py
```

## 8. Pre-Execution Checklist
- [x] Infrastructure `.antigravity/team/` created
- [ ] Role-specific scripts available or generator ready
- [ ] `.env_shared` populated with API keys

## 9. Post-Execution Checklist
- [ ] `tasks.json` shows multiple "DONE" tasks
- [ ] No stale `locks` remaining
- [ ] Logs show correct role transitions
