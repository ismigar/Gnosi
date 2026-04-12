# Directive: CONSOLIDATED_LOGGING_PROTOCOL

> ID: 2026-04-07
> Associated Script: monorepo/apps/gnosi/pipeline/sandbox/refactor_logging.py
> Last Update: 2026-04-07
> Status: ACTIVE

---

## 1. Objectives and Scope

- **Main Objective:** Eliminate all non-essential debug logs (`console.log` and `print`) and replace them with a structured logging system where necessary.
- **Success Criteria:** 
    - Zero `console.log` in frontend production code.
    - Zero `print()` in API/Backend code (replaced by `logger.info`, `error`, etc.).
    - Maintain `print()` only in strictly user-facing terminal scripts (`scripts/`).

---

## 2. Input/Output (I/O) Specifications

### Inputs
- **Source Files:**
    - `monorepo/apps/gnosi/frontend/src/**/*`
    - `monorepo/apps/gnosi/backend/**/*.py`

---

## 3. Logical Flow (Algorithm)

1. **Audit:** Scan the monorepo for log patterns.
2. **Classification:**
    - **Trivial Logs:** Delete completely.
    - **Error Logs:** Convert to `console.error` (frontend) or `logger.exception/error` (backend).
    - **Data Debugging:** Delete or convert to `logger.debug`.
3. **Refactor:** Run Python scripts in the `sandbox` to apply changes massively and safely.
4. **Verification:** Run linter and build to ensure no regressions.

---

## 5. Restrictions and Edge Cases

- **CLI Tools:** Scripts intended to be run manually in the console can keep `print` for real-time user feedback.
- **Production Build:** The Vite build should already have rules to remove `console.log`, but we will remove them from the source to clean up the development environment.

---

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 2026-04-07 | N/A | Initialization | N/A |
