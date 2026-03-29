# DIRECTIVE: Graph Suggestion Acceptance and Real-Time Connection Proposal

> ID: GSA-2026-03-08
Associated Script: `pipeline/sandbox/graph_suggestion_handler.py` (Phase 1) + `backend/services/graph_suggestions.py` (consolidation)
Last Update: 2026-03-08
Status: DRAFT
> 

---

## 1. Objectives and Scope

Real-time reading of vault `.md` files requires smarter management of AI-suggested connections. Currently, suggestions are static (batch-generated `suggestions.json`). This directive establishes a **hybrid approach**: batch suggestions for initial load (fast) + on-demand real-time suggestions when user requests them.

- **Main Objective:** Enable the graph service to **accept AI-suggested connections** by writing them to vault `.md` frontmatter as `📀 Relations`, and provide infrastructure for on-demand suggestion generation without replacing batch processing.
- **Success Criteria:** 
  - ✅ Graph service can accept a suggestion and atomically write it to `.md` frontmatter
  - ✅ Frontmatter syntax is preserved (valid YAML + emoji-prefixed relation keys)
  - ✅ API endpoint `POST /graph/accept-suggestion` works end-to-end
  - ✅ Optional: on-demand suggestions can be requested via `POST /graph/suggest-connections/{node_id}`

---

## 2. Input/Output (I/O) Specifications

### Inputs

- **Required Arguments (POST body):**
    - `source_id`: str - Node ID of the note making the connection
    - `target_id`: str - Node ID of the target note
    - `reason`: str (optional) - Why this connection was suggested (e.g., "Shared topics: AI, cognition")

- **Environment Variables (.env):**
    - `VAULT_PATH`: Absolute path to vault root (e.g., `/Users/.../Calendar`)
    - `APP_BASE_URL`: Backend URL (default: http://localhost:5001)

- **Source Files:**
    - `vault/.md/*`: Markdown files with YAML frontmatter
    - `vault/suggestions.json` (optional): Pre-computed batch suggestions

### Outputs

- **Generated Artifacts:**
    - Modified `.md` frontmatter: adds/updates `📀 Connexions` (or language-specific key) with target ID
    - Atomized write: write to temp file, then rename (no partial updates)
    - Response: JSON with `{success: true, updated_file: "path", new_relations: [...]}`

- **Console Output (for scripts):**
    - JSON summary: `{"Total suggestions processed": 42, "Accepted": 38, "Skipped": 4}`

---

## 3. Logical Flow (Algorithm)

### Phase 1: Accept Suggestion (MVP)

1. **Validation:**
   - Check that `source_id` and `target_id` exist in vault (i.e., `.md` files or in registry)
   - Check that `.md` file for `source_id` exists and is readable
   - Verify frontmatter is valid YAML

2. **Parse Frontmatter:**
   - Read `.md` file → extract metadata and body
   - Identify existing `📀` relation keys (language-sensitive: "Connexions", "Connections", "Related Notes", etc.)
   - If no relation key exists, use default: `📀 Connexions` (or per-config)

3. **Add Relation:**
   - Append `target_id` to the relations list (avoid duplicates)
   - Optionally store `reason` in a separate field or comments

4. **Write Atomically:**
   - Serialize updated metadata + body back to YAML + Markdown
   - Write to temp file in `.tmp/`
   - Rename temp to original (atomic operation)

5. **Response:**
   - Return `{success: true, updated_file: path, new_relations: [...]}`
   - Log change: timestamp, source, target, reason

### Phase 2: Real-Time Suggestions (Optional, On-Demand)

1. **User requests suggestions for a node** (e.g., "Find connections for Note X")
2. **Graph fetches the note's metadata** (title, tags, type, body excerpt)
3. **Call suggestion engine** (LLM-based or similarity-based)
4. **Return proposals** without saving (user must approve via Phase 1 flow)
5. **Frontend displays** with "Accept" buttons → calls Phase 1

---

## 4. Tools and Libraries

- **Python libraries:** `pathlib`, `yaml`, `json`, `re`, `uuid`, `logging`, `shutil` (for atomic rename)
- **External APIs:** None (Phase 1); optionally: OpenAI/Groq (Phase 2)
- **File Operations:** Atomic writes only (temp → rename, never in-place edit)

---

## 5. Restrictions and Edge Cases

- **Frontmatter Integrity:** Must not corrupt YAML. Use `yaml.safe_dump()` with proper formatting.
- **Concurrency:** Do NOT run suggestion acceptance in parallel on the same file (risk of race conditions).
- **Character Encoding:** Always use UTF-8; handle emoji properly in relation keys.
- **Circular References:** Allow (e.g., A → B and B → A), but frontend should warn.
- **Non-existent Targets:** Reject suggestions where `target_id` node doesn't exist.
- **Duplicate Prevention:** If relation already exists, skip (no error, just log).
- **Backup Strategy:** Keep `.md.bak` before write, or rely on git auto-commit post-write.
- **Performance:** If vault has >10k notes, suggestion computation (Phase 2) must be paginated/throttled.

---

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 2026-03-08 | (None yet) | (Starting phase) | (To be updated after first implementation) |

> **Learning Note:** After frontmatter parsing fails, always check for mixed tabs/spaces in YAML. YAML is whitespace-sensitive; use only spaces (4 per level).
> 

---

## 7. Examples of Use

### Phase 1: Accept a Suggestion

```bash
# Test: Accept suggestion (source: "note-1", target: "note-2")
curl -X POST http://localhost:5001/graph/accept-suggestion \
  -H "Content-Type: application/json" \
  -d '{
    "source_id": "note-1",
    "target_id": "note-2",
    "reason": "Shared topic: Machine Learning"
  }'

# Response:
# {"success": true, "updated_file": "Calendar/note-1.md", "new_relations": ["note-2"]}
```

### Phase 1 (Script): Bulk Accept from suggestions.json

```bash
python pipeline/sandbox/graph_suggestion_handler.py --vault /path/to/vault \
  --suggestions suggestions.json \
  --threshold 0.75 \
  --dry-run
```

### Phase 2 (Future): Request Suggestions On-Demand

```bash
curl -X POST http://localhost:5001/graph/suggest-connections/note-1 \
  -H "Content-Type: application/json" \
  -d '{"limit": 5, "threshold": 0.6}'

# Response:
# {"suggestions": [
#   {"target_id": "note-3", "score": 0.85, "reason": "Semantic similarity + tag overlap"},
#   ...
# ]}
```

---

## 8. Pre-Execution Checklist

- [ ]  `VAULT_PATH` configured and accessible
- [ ]  `.md` files in vault have valid YAML frontmatter (checked with parser)
- [ ]  Existing `suggestions.json` available (optional, for Phase 1 bulk testing)
- [ ]  Dependencies installed: `pyyaml`, `pathlib2` (if Python < 3.4)
- [ ]  Backup of vault exists (or git initialized)
- [ ]  `.tmp/` directory writable

---

## 9. Post-Execution Checklist

- [ ]  Modified `.md` files have valid frontmatter (re-parse with `yaml.safe_load()`)
- [ ]  No duplicate relations added
- [ ]  All relations point to existing nodes (validate against registry)
- [ ]  Frontmatter emoji keys preserved correctly
- [ ]  Git status shows expected changes (if using git auto-commit)
- [ ]  Logs reviewed for warnings or skipped suggestions

---

## 10. Additional Notes

**Naming Conventions:**
- Relation key (emoji + field): `📀 Connexions` (Catalan), `📀 Conexiones` (Spanish), `📀 Connections` (English)
  - Configurable per vault via `params.yaml`: `graph.relation_key`
- Suggestion source tracking (optional): `suggested_by: "ai"` vs `suggested_by: "user"` for future filtering

**Git Integration (Optional but Recommended):**
- After accepting a suggestion, optionally run: `git add vault/.md && git commit -m "Accept suggestion: X → Y"`
- This provides audit trail + rollback capability

**Future Enhancements:**
- Confidence scoring: Store `📀 Connexions: [{"target": "note-2", "score": 0.85}]` instead of flat list
- User feedback loop: Track accepted/rejected suggestions to tune thresholds
- Batch operations: Accept multiple suggestions in one API call (transaction-like)
