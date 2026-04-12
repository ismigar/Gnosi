# SKILL: Graph Management

This skill manages the Digital Brain knowledge graph, including the generation of connections, their acceptance, and the hybrid AI system.

> ID: GRAPH-MGMT-20260408
> Status: ACTIVE

---

## 1. Module A: Generation (Suggest Connections)
Analyzes Vault notes and suggests relationships based on tags and semantic content.

- **Config**: `config/params.yaml` (Thresholds, graph colors).
- **Outputs**: `out/suggestions.json`, `out/sigma_graph.json`, AI caches.
- **CLI**: `python3 -c "from pipeline.skills.suggest_connections.scripts.suggest_connections_digital_brain import process; process()"`

---

## 2. Module B: Persistence (Acceptance Protocol)
Protocol for writing accepted connections back to `.md` files.

### Writing Requirements
- **Frontmatter Field**: `📀 Connections` (or as per language in `params.yaml`).
- **Data Integrity**: Use `yaml.safe_dump` to avoid corruption.
- **Atomicity**: Write to a temporary file + rename to prevent data loss if the process fails.

### Validation
- No duplicates allowed.
- No connections allowed to non-existent nodes (verify against the registry).

---

## 3. Hybrid AI System (Ollama + Groq)
Infrastructure management for artificial intelligence.

- **Preference**: Ollama (local) → Groq (Cloud) → OpenAI.
- **Fallback**: If Ollama times out (60s) or the note is too long, automatically switch to Groq.
- **Rate Limits**: Groq has a limit of 100k tokens/day (Free Tier). If error 429 is received, wait 24h.

---

## 4. History and Learning (Learning Cycle)

| Date | Error / Learning | Root Cause | Solution / Refinement |
| --- | --- | --- | --- |
| 2026-03-08 | YAML Corruption | Manual writing | Mandatory use of YAML parsing libraries. |
| 2026-04-07 | Groq 429 Error | Token excess | Implementation of analyzed notes cache to avoid repetitions. |
| 2026-04-08 | Fragmentation | Divided memory | Union of Generation, Persistence, and AI into `SKILL.md`. |

---
*Maintenance: If new models are added to Ollama, update `params.yaml` to reflect the correct `model_name`.*
