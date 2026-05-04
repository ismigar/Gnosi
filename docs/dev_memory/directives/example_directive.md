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

## 7. Rationalizations (Anti-Atajos)

*Lista de excusas comunes u omisiones que el Agente / Desarrollador podría pensar para ahorrar tiempo y por qué son inválidas.*

| Excusa / Racionalización | Refutación y Consecuencia |
| --- | --- |
| *"Puedo hacer commit sin hacer una prueba visual porque solo he cambiado variables o texto."* | **Falso.** Un error simple de tipeo romperá el build del Frontend. Obligatorio lanzar `npm run build` o verlo en el navegador. |
| *"No documentaré este error temporal porque ya lo he arreglado en el código."* | **Falso.** Si pasó una vez, el próximo agente caerá en la misma trampa. Actualiza la Sección 6 inmediatamente. |

## 8. Red Flags (Señales de Peligro)

*Pausa el proceso y reevalúa el plan antes de continuar si ocurre alguna de estas condiciones:*

- Estás reescribiendo más de 30-50 líneas de código que "parecía" que debían funcionar, sin investigar el *root cause*.
- Estás intentando lanzar comandos `bash` fuera del contenedor de Docker en lugar de seguir la arquitectura de pipelines de Python en `sandbox/`.
- Has encadenado 2 o 3 errores seguidos usando el mismo approach. Se requiere un paso de *diagnóstico* antes de continuar lanzando comandos parche.

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

*CRÍTICO: No se puede dar la tarea por "Finalizada" sin poder presentar "Evidencias" tangibles.*

- [ ]  Outputs generados e **inspeccionados explícitamente** (No asumas que se generó, léelo).
- [ ]  Logs revisados y limpios de errores/warnings.
- [ ]  Resultados validados contra el criterio de éxito empíricamente (Ej. Pantallazo del navegador confirmando UI, o CURL validando endpoint).
- [ ]  Directiva actualizada con los nuevos aprendizajes y "Red Flags" encontradas en la sesión.

## 12. Additional Notes

Any context that does not fit into the previous sections.

[Placeholder for design decisions, references to external documentation, or security warnings].