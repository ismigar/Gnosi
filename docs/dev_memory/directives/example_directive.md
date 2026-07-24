# Example directive

# DIRECTIVE: [KEY_NAME_OF_THE_SOP_TASK]

> ID: [UNIQUE_ID_OR_DATE]
Associated Script: scripts/[script_name].py Last Update: [CURRENT_DATE]
Status: [DRAFT / ACTIVE / DEPRECATED]
> 

---

## 1. Objectives and Scope

*Describe here WHAT this task should achieve and WHY.*

- **Main Objective:** [Concise description of the final goal, e.g., "Extract financial data from the AlphaVantage API and normalize it to CSV."]
- **Success Criteria:** [Exact condition for considering the task complete, e.g., "The output.csv file exists and is not empty."]

## 2. Input/Output (I/O) Specifications

*Strictly define data types to ensure determinism.*

### Inputs

- **Required Arguments:**
    - `[arg_name]`: [Data type] - [Description].
- **Environment Variables (.env):**
    - `[VAR_NAME]`: [Description of the secret/token required].
- **Source Files:**
    - `[path/to/file]`: [Description].

### Outputs

- **Generated Artifacts:**
    - `[output/path]`: [Format and description of content].
- **Console Output:** [What the script should print when finished: JSON, Path, or Success Message].

## 3. Logical Flow (Algorithm)

*DO NOT write code here. Describe the logic step by step so that any future script can replicate the process.*

1. **Initialization:** [E.g.: Load environment variables and validate folder existence].
2. **Acquisition:** [e.g., Connect to database X].
3. **Processing:** [E.g.: Filter rows where column Y is null].
4. **Persistence:** [e.g., Save result in .tmp/].
5. **Cleanup:** [e.g., Close connections].

## 4. Tools and Libraries

*Whitelist of allowed dependencies.*

- **Python libraries:** `[pandas]`, `[requests]`, `[os]`.
- **External APIs:** [API name and version].

## 5. Restrictions and Edge Cases

*Known conditions that could break the standard flow.*

- **Limits:** [e.g., "The API only allows 5 calls per minute"].
- **Formats:** [e.g., "If the input contains special characters, the script must sanitize them first"].
- **Concurrency:** [e.g., "Do not run this script in parallel"].

## 6. Error Protocol and Learning (Live Memory)

*CRITICAL: This section is automatically updated after failures. This is where the accumulated intelligence resides.*

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| [DD/MM] | [Error Type] | [Why it failed] | [Instruction: "Use method X instead of Y"] |
| ... | ... | ... | ... |

> Implementation Note: If you find a new error, first fix it in the script, then document the rule here to prevent future regressions.
> 

## 7. Rationalizations

Common shortcuts an agent or developer might consider and why they are
invalid.

| Rationalization | Consequence |
| --- | --- |
| "I can commit without visual QA because I changed only variables or text." | False. A typo can break the frontend build. Run `npm run build` and inspect the result in a browser. |
| "I do not need to document this temporary error because the code is fixed." | False. Future maintainers can repeat it. Update Section 6 immediately. |

## 8. Red flags

Pause and reassess before continuing when any of these conditions occurs:

- More than 30–50 apparently valid lines are being rewritten without a root
  cause.
- Commands are being run in the wrong runtime instead of following the
  current native-first environment directive.
- The same approach has failed two or three times without a new diagnostic
  step.

## 9. Examples of Use

*Commands to invoke the associated script.*

```bash
# Standard execution
python scripts/[script_name].py --input "value"

```

## 10. Pre-Execution Checklist

- [ ]  Environment variables configured in `.env`
- [ ]  Dependencies installed (`pip install -r requirements.txt`)
- [ ]  Input files available and validated
- [ ]  Necessary permissions granted (API, files, etc.)

## 11. Post-Execution Checklist (Verification Gates)

Do not mark the task complete without tangible evidence.

- [ ] Generated output explicitly inspected.
- [ ] Logs reviewed and free of relevant errors or warnings.
- [ ] Results validated empirically against success criteria.
- [ ] Directive updated with new constraints and red flags.

## 12. Additional Notes

Any context that does not fit into the previous sections.

[Placeholder for design decisions, references to external documentation, or security warnings].
