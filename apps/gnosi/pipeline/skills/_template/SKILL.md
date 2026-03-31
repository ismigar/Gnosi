---
name: [skill_name_lowercase]
description: [Short description of what this skill does]
---

# Skill: [Human Readable Name]

> **Status:** [DRAFT / ACTIVE / DEPRECATED]
> **Associated Scripts:** `scripts/*.py`

## 1. Objectives and Scope

*Describe here WHAT this skill achieves and WHY.*

- **Main Objective:** [Concise description]
- **Success Criteria:** [Exact condition for considering the task complete]

## 2. Input/Output (I/O) Specifications

*Strictly define data types to ensure determinism.*

### Inputs
- **Required Arguments:**
    - `[arg_name]`: [Data type] - [Description].
- **Environment Variables (.env_shared):**
    - `[VAR_NAME]`: [Description].

### Outputs
- **Return Value:** [What the script returns/prints]
- **Side Effects:** [Files created, DBs updated, etc.]

## 3. Usage & Examples

### Basic Usage
```python
# Import from the scripts submodule
from pipeline.skills.[skill_name].scripts.main import MyClass

tool = MyClass()
tool.run()
```

### CLI Usage
```bash
python pipeline/skills/[skill_name].scripts.main.py --arg value
```

## 4. Technical Implementation

*High-level logic flow.*

1. **Initialization:** ...
2. **Processing:** ...
3. **Output:** ...

## 5. Restrictions and Edge Cases (Live Memory)

*Known conditions that could break the standard flow. Update this section after every failure.*

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| [DD/MM] | [Error Type] | [Why it failed] | [Instruction] |

## 6. Pre-Execution Checklist

- [ ] `.env_shared` contains necessary keys
- [ ] Dependencies installed in `requirements.txt`
