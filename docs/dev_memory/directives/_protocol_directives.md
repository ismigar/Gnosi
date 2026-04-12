# Directive: Development Protocol

## Objective
A workflow that combines internal artifacts (fast tracking) with persistent directives (permanent knowledge).

## The Central Loop

### PHASE 1: PLANNING
```
1. Consult existing directives
   → ls docs/dev_memory/directives/
   → If a relevant one exists, read it

2. Create implementation_plan.md (internal artifact)
   → Location: ~/.gemini/antigravity/brain/<id>/
   → Content: proposed changes, affected files

3. Request user approval
```

### PHASE 2: EXECUTION
```
4. Update task.md (internal artifact)
   → Real-time tracking with checkboxes

5. Note errors/edge cases found
   → To include them in the final directive
```

### PHASE 3: COMPLETION
```
6. Create walkthrough.md (internal artifact)
   → Summary of what was done
   → Screenshots if applicable

7. ⭐ CONVERT WALKTHROUGH TO DIRECTIVE
   → Location: docs/dev_memory/directives/<task_name>.md
   → Format: Procedure + Edge Cases + Verification
```

## Key Rule
> **At the end of each complex task, ALWAYS generate/update a directive in `docs/dev_memory/directives/`**

## Task Final Checklist
- [ ] Code working and verified
- [ ] Internal artifacts updated (task.md, walkthrough.md)
- [ ] **Directive created/updated in docs/dev_memory/directives/**
- [ ] Edge cases documented in the directive

## When NOT to create a directive
- Simple questions or casual conversation
- Trivial edits (1-2 lines)
- Tasks that do not provide reusable knowledge

## Annex: Walkthrough → Directive Conversion

| Walkthrough Section | Directive Section |
|-------------------|------------------|
| Summary | Objective |
| Changes Made | Procedure |
| What was tested | Verification |
| Errors encountered | Restrictions / Edge Cases |
| Files modified | Related Files |
