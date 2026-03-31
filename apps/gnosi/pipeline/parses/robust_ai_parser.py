#!/usr/bin/env python3

from typing import Dict, List, Any, Optional
import time
import requests, re
import unicodedata
import logging
from pathlib import Path
from config.logger_config import get_logger
from config.app_config import load_params
from pipeline.ai_client import call_ai_client, call_ai_with_fallback, get_provider_config, PRIMARY_PROVIDER
from pipeline.utils.ai_analysis_cache import get_pending_queue
import json

cfg = load_params(strict_env=False)
log = get_logger(__name__)

# Configuration for AI Model timeouts and retries
AI_MODEL_BACKOFF = float(cfg.ai.get("backoff", 1.5))

STOPWORDS_PATH = cfg.paths.get("STOPWORDS_PATH")

# Get provider-specific config (hybrid system)
try:
    _primary_config = get_provider_config(PRIMARY_PROVIDER)
    AI_MODEL_TIMEOUT = int(_primary_config.get("timeout", 60))
    AI_MODEL_RETRIES = int(_primary_config.get("retries", 1))
    AI_MODEL_NAME = str(_primary_config.get("model_name", "llama3.2"))
except Exception:
    AI_MODEL_TIMEOUT = int(cfg.ai.get("timeout", 180))
    AI_MODEL_RETRIES = int(cfg.ai.get("retries", 2))
    AI_MODEL_NAME = str(cfg.ai.get("model_name", "llama3.2"))

# Minimum similarity threshold (0–100). Can be varied externally if needed.
MIN_SIM = int(cfg.ai.get("min_similarity", 65))

# --- "reason" Validation ---
MIN_REASON_WORDS = int(cfg.ai.get("min_reason_words", 5))
MAX_REASON_WORDS = int(cfg.ai.get("max_reason_words", 25))
MIN_CONTENT_WORDS = int(cfg.ai.get("min_content_words", 3))

_CONTENT_TOKEN_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ']+", flags=re.UNICODE)

# --- Stopwords Configuration ---

# --- Attempt to import STOPWORDS_PATH from config ---
try:
    from config import STOPWORDS_PATH as _SW_CONF_PATH
except Exception:
    _SW_CONF_PATH = None

# Global Stopwords Cache
_STOPWORDS_ALL: set[str] = set()

def _nonempty_path(p) -> Optional[Path]:
    """Returns Path if p is a non-empty path; else None."""
    if not p:
        return None
    try:
        s = str(p).strip()
        if not s:
            return None
        return Path(s)
    except Exception:
        return None

def _project_root_from_this_file(levels: int = 2) -> Path:
    """Determine project root relative to this module (e.g. .../notion-scripts)."""
    return Path(__file__).resolve().parents[levels]

def _candidate_paths() -> list[Path]:
    env_p = str(STOPWORDS_PATH or "").strip()
    candidates: list[Path] = []

    # 1. Check config.paths_config if exists
    if _SW_CONF_PATH:
        p = _nonempty_path(_SW_CONF_PATH)
        if p: candidates.append(p)

    # 2. Check environment variable (only if not empty)
    p_env = _nonempty_path(env_p)
    if p_env: candidates.append(p_env)

    # 3. Check same directory as module
    candidates.append(Path(__file__).resolve().parent / "stopwords.json")

    # 4. Check repo root (2 levels up) -> config/stopwords.json
    root2 = _project_root_from_this_file(2)
    candidates.append(root2 / "src" / "config" / "stopwords.json")

    # 5. Check repo root (3 levels up) in case module moves
    root3 = _project_root_from_this_file(3)
    candidates.append(root3 / "src" / "config" / "stopwords.json")

    # 6. Check CWD (only as last resort)
    candidates.append(Path.cwd() / "src" / "config" / "stopwords.json")

    # dedup preserving order
    seen = set()
    uniq = []
    for c in candidates:
        key = str(c)
        if key not in seen:
            seen.add(key)
            uniq.append(c)
    return uniq

def _load_stopwords() -> set[str]:
    """
    Loads stopwords from available candidate paths.
    Accepts:
      - JSON simple list
      - JSON with key {"all": [...]}.
    """
    global _STOPWORDS_ALL
    if _STOPWORDS_ALL:
        return _STOPWORDS_ALL

    last_err = None
    for p in _candidate_paths():
        try:
            if not p or not p.exists() or not p.is_file():
                # Leave trace to know why it wasn't tried
                logger.info("Stopwords: skip (no file) → %s", p)
                continue

            logger.info("Stopwords: trying to load from %s", p)
            with p.open("r", encoding="utf-8") as f:
                data = json.load(f)

            if isinstance(data, dict):
                words = data.get("all", [])
            elif isinstance(data, list):
                words = data
            else:
                words = []

            _STOPWORDS_ALL = { (w or "").strip().lower()
                               for w in words if isinstance(w, str) and w.strip() }
            logger.info("🧠 Stopwords loaded from: %s (%d words)", p, len(_STOPWORDS_ALL))
            return _STOPWORDS_ALL

        except Exception as e:
            last_err = e
            # Raise to INFO while diagnosing
            logger.info("Stopwords: error reading %s → %s", p, e)

    logger.warning("⚠️ Could not load stopwords. Continuing without stopwords.%s",
                   f" Last error: {last_err}" if last_err else "")
    _STOPWORDS_ALL = set()
    return _STOPWORDS_ALL

def _tokenize_words(s: str) -> list[str]:
    return [t.lower() for t in _CONTENT_TOKEN_RE.findall(s or "")]

def _looks_ca_es(s: str) -> bool:
    """
    Heuristic: Identify language based on stopword presence.
    If at least 2 stopwords are found, consider it a match.
    If no stopwords loaded, do not block and return True (neutral).
    """
    tokens = set(_tokenize_words(s))
    stops = _load_stopwords()
    if not stops:
        return True
    return len(tokens & stops) >= 2

# --- Reason Validation ---
def reason_ok(reason: str) -> bool:
    """
    Validate reason based on word count and content.
    Accepts if:
      1. Total words in [8, 20]
      2. At least 5 content words (non-stopwords) with len>=3
    """
    if not reason:
        return False
    tokens = _tokenize_words(reason)
    total = len(tokens)
    if total < MIN_REASON_WORDS or total > MAX_REASON_WORDS:
        return False

    stops = _load_stopwords()
    content = [t for t in tokens if (t not in stops and len(t) >= 3)]
    return len(content) >= MIN_CONTENT_WORDS

def _coerce_int_0_100(x):
    try:
        if isinstance(x, str):
            x = x.strip().rstrip("%")
        v = int(round(float(x)))
    except Exception:
        return None
    return max(0, min(100, v))

def _norm_reason(s: str) -> str:
    s = (s or "").strip()
    return re.sub(r"\s+", " ", s)

def _strip_id(raw_id: str) -> str:
    if not raw_id:
        return ""
    return re.sub(r'^[\[\(\s]*|[\]\)\s]*$', '', raw_id.strip())

def _extract_connections(data) -> list[dict]:
    """
    Accepts:
      - List of objects [{"id","similarity","reason"}, ...]
      - Object with key 'connections' / 'conceptual_connections' / 'results' / 'items' / 'data' / 'result'
      - Object { "id": "...", "similarity": ..., "reason": "..." } (single element)
      - Dictionary indexed by UUID: { "<uuid>": {"similarity": ..., "reason": "..."} , ... }
      - Nested envelopes: e.g. {"result": {"connections": [...]}}
    Returns: normalized list [{'id','similarity','reason'}]
    """
    items: list[dict] = []

    def _push(d: dict):
        _id = (d.get("id") or d.get("uuid") or "").strip()
        sim = _coerce_int_0_100(d.get("similarity") or d.get("score"))
        reason = _norm_reason(d.get("reason") or d.get("because") or d.get("rationale"))
        if not _id or sim is None:
            return
        items.append({"id": _id, "similarity": int(sim), "reason": reason})

    def _collect_from_list(lst):
        for el in lst:
            if isinstance(el, dict):
                _push(el)

    # Case 1: it is already a list
    if isinstance(data, list):
        _collect_from_list(data)
        return items

    # Case 2: object/envelope
    if isinstance(data, dict):
        # 2a) direct keys
        for key in ("connections", "connection", "conceptual_connections", "results", "items", "data", "result"):
            v = data.get(key)
            if isinstance(v, list):
                _collect_from_list(v)
                return items
            if isinstance(v, dict):
                # 2b) nested envelope: look inside again
                for k2 in ("connections", "conceptual_connections", "results", "items", "data"):
                    v2 = v.get(k2) if isinstance(v, dict) else None
                    if isinstance(v2, list):
                        _collect_from_list(v2)
                        return items

        # 2c) unitary object with fields
        if "id" in data and ("similarity" in data or "score" in data):
            _push(data)
            return items

        # 2d) dictionary indexed by UUID
        for k, v in list(data.items()):
            if isinstance(v, dict) and ("similarity" in v or "reason" in v or "score" in v):
                d = {"id": k, "similarity": v.get("similarity", v.get("score")), "reason": v.get("reason")}
                _push(d)

    return items

def _parse_ai_json_robust(raw: str) -> list[dict]:
    """
    Attempt to parse JSON using multiple strategies:
      1. json.loads directly
      2. Extract first reasonable JSON block (object or array) from text
      3. Return a normalized list of connections [{id, similarity, reason}, ...]
    """
    if not raw:
        return []

    # 1. Direct attempt
    try:
        data = json.loads(raw)
        items = _extract_connections(data)
        if items:
            return items
    except Exception:
        pass

    # 2. Remove fences/backticks and take the first big JSON array/object
    txt = raw.strip()
    txt = re.sub(r"^```(?:json)?|```$", "", txt.strip(), flags=re.IGNORECASE|re.MULTILINE).strip()

    # try array [...] first
    m = re.search(r"\[\s*\{[\s\S]*?\}\s*\]", txt)
    if m:
        try:
            data = json.loads(m.group(0))
            items = _extract_connections(data)
            if items:
                return items if isinstance(items, list) else data
        except Exception:
            pass

    # then an object { ... } (may contain the envelope)
    m = re.search(r"\{\s*\"[^\"]+\"\s*:\s*[\[\{][\s\S]*", txt)
    # try also the longest object (until the last } )
    if not m:
        first = txt.find("{")
        last  = txt.rfind("}")
        if first != -1 and last != -1 and last > first:
            candidate = txt[first:last+1]
            try:
                data = json.loads(candidate)
                items = _extract_connections(data)
                if items:
                    return items
            except Exception:
                pass
    else:
        candidate = txt[m.start(): txt.rfind("}")+1]
        try:
            data = json.loads(candidate)
            items = _extract_connections(data)
            if items:
                return items
        except Exception:
            pass

    return []


# Module logger
logger = logging.getLogger(__name__)

class RobustAIResponseParser:
    """Robust parser to handle inconsistent AI responses"""

    def __init__(self, valid_nodes: List[Dict[str, Any]]):
        """
        valid_nodes: List of valid nodes with 'id' and 'title'
        """
        self.uuid_pattern = re.compile(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
            re.I
        )

        # Create multiple indices for mapping
        self.id_to_node = {n['id']: n for n in valid_nodes}
        self.title_to_id = {}
        self.slug_to_id = {}
        self.partial_to_id = {}

        for node in valid_nodes:
            title = node.get('titulo', '').strip()
            if title:
                # Exact title mapping
                self.title_to_id[title.lower()] = node['id']

                # Slug mapping (title converted to slug)
                slug = self._to_slug(title)
                self.slug_to_id[slug] = node['id']

                # First words mapping
                words = title.lower().split()[:3]
                if words:
                    key = ' '.join(words)
                    self.partial_to_id[key] = node['id']

    def _to_slug(self, text: str) -> str:
        """Converts text to slug"""
        text = text.lower()
        text = re.sub(r'[àáäâ]', 'a', text)
        text = re.sub(r'[èéëê]', 'e', text)
        text = re.sub(r'[ìíïî]', 'i', text)
        text = re.sub(r'[òóöô]', 'o', text)
        text = re.sub(r'[ùúüû]', 'u', text)
        text = re.sub(r'[ñ]', 'n', text)
        text = re.sub(r'[ç]', 'c', text)
        text = re.sub(r'[^\w\s-]', '', text)
        text = re.sub(r'[-\s]+', '-', text)
        return text.strip('-')

    def _extract_json_from_text(self, text: str) -> Optional[Any]:
        def score_obj(o):
            if isinstance(o, dict):
                keys = {k.lower() for k in o.keys()}
                hits = len(keys & {"conexiones", "connections", "suggestions", "results", "result"})
                inner = 0
                for k in ("conexiones", "connections", "suggestions", "results", "result"):
                    v = o.get(k)
                    if isinstance(v, list) and any(isinstance(x, dict) for x in v):
                        inner += 1
                return 2 * hits + inner
            if isinstance(o, list):
                return 1 + int(any(isinstance(x, dict) for x in o))
            return 0

        if not text:
            return None

        t = text.strip()
        # Case 1: entire response is already a JSON array
        if t.startswith("[") and t.endswith("]"):
            try:
                return json.loads(t)
            except Exception:
                pass

        # Collect candidates
        blocks = []
        blocks += re.findall(r"```json\s*(.*?)\s*```", text, flags=re.DOTALL | re.IGNORECASE)
        blocks += re.findall(r"```(?:jsonc?|javascript)\s*(.*?)\s*```", text, flags=re.DOTALL | re.IGNORECASE)
        blocks += re.findall(r"```\s*(.*?)\s*```", text, flags=re.DOTALL | re.IGNORECASE)
        blocks += re.findall(r"\[.*?\]|\{.*?\}", text, flags=re.DOTALL)

        candidates = sorted(blocks, key=lambda x: -len(x or ""))

        logger.debug("[debug] id_to_node keys (first 3): %s", list(self.id_to_node.keys())[:3])
        logger.debug("[debug] raw candidates collected: %s", len(candidates))

        parsed, seen = [], set()
        for chunk in candidates:
            if not isinstance(chunk, str):
                continue
            s = chunk.strip()
            for trial in (s, s.rstrip(",;")):
                try:
                    obj = json.loads(trial)
                    key = json.dumps(obj, ensure_ascii=False, sort_keys=True)
                    if key not in seen:
                        parsed.append(obj)
                        seen.add(key)
                    break
                except Exception:
                    continue

        if not parsed:
            return None

        parsed.sort(key=score_obj, reverse=True)
        return parsed[0]

    def _resolve_id(self, value: str) -> Optional[str]:
        if not value or not isinstance(value, str):
            return None

        # Normalize ID string for matching: remove containers and invisibles
        v = unicodedata.normalize("NFKC", value)
        v = v.strip().strip("[](){}<>")
        v = v.replace("–", "-").replace("—", "-").replace("−", "-")
        v = v.replace("\u200b", "").replace("\ufeff", "").replace("\u00a0", " ")
        v_stripped = v.strip()

        # 1. UUID present in text?
        m = self.uuid_pattern.search(v_stripped)
        if m:
            uid = m.group(0).lower()
            return uid if uid in self.id_to_node else None

        # 2. Mapping by title/slug/partials (do not pass to [0-9a-f-]!)
        v_lower = v_stripped.lower()

        if v_lower in self.title_to_id:
            return self.title_to_id[v_lower]

        slug = self._to_slug(v_lower)
        if slug in self.slug_to_id:
            return self.slug_to_id[slug]

        words = v_lower.split()[:3]
        if words:
            key = " ".join(words)
            if key in self.partial_to_id:
                return self.partial_to_id[key]

        for title, node_id in self.title_to_id.items():
            if v_lower in title or title in v_lower:
                return node_id

        return None

    def parse_ai_response(self, response_text: str) -> List[Dict[str, Any]]:
        """
        Main parser for handling diverse AI response formats.
        """
        connections = []

        # Extract JSON from text
        data = self._extract_json_from_text(response_text)
        if data is None:
            logger.debug("[parser] No JSON found in AI response")

        if not data:
            return connections

        # Normalize response structure
        candidates = []

        if isinstance(data, dict):
            if 'conexiones' in data:
                candidates = data['conexiones']
            elif 'connections' in data:
                candidates = data['connections']
            elif 'suggestions' in data:
                candidates = data['suggestions']
            elif 'results' in data:
                candidates = data['results']
            else:
                candidates = [data]
        elif isinstance(data, list):
            candidates = data

        # --- NORMALIZATION: Normalize vectorized responses (lists of IDs/similarities)
        normalized = []
        for it in candidates:
            if isinstance(it, dict) and isinstance(it.get("id"), list):
                ids = it.get("id") or []
                sims = it.get("similarity")
                reas = it.get("reason")

                # Convert scalar → list of same length as ids
                if not isinstance(sims, list):
                    sims = [sims] * len(ids)
                if not isinstance(reas, list):
                    reas = [reas] * len(ids)

                for i, _id in enumerate(ids):
                    normalized.append({
                        "id": _id,
                        "similarity": sims[i] if i < len(sims) else None,
                        "reason": reas[i] if i < len(reas) else ""
                    })
            else:
                normalized.append(it)
        candidates = normalized

        if isinstance(data, list):
            logger.debug("[debug] AI list length: %d", len(data))
        elif isinstance(data, dict):
            logger.debug("[debug] AI dict keys: %s", list(data.keys()))
        else:
            logger.debug("[debug] AI data type: %s", type(data))

        # Validate and process each candidate connection
        for item in candidates:
            if not isinstance(item, dict):
                continue
            # (rest of your code: resolve id, score/sim, reason, filters, append)

            possible_id_fields = ['id', 'target_id', 'node_id', 'page_id', 'titulo', 'title', 'name']
            resolved_id = None

            for field in possible_id_fields:
                if field in item:
                    raw_val = item[field]
                    logger.debug("trying field '%s' with value (repr): %r", field, raw_val)
                    resolved_id = self._resolve_id(raw_val)
                    logger.debug("resolved to: %r", resolved_id)
                    if resolved_id:
                        break

            if not resolved_id:
                logger.debug("[parser] Could not resolve id from item: %r", item)
                continue

            if resolved_id not in self.id_to_node:
                continue

            # --- Normalize score and similarity values
            score = 0.5
            raw_sim_int: Optional[int] = None
            score_fields = ['similitud', 'score', 'similarity', 'confidence']
            for field in score_fields:
                if field in item:
                    try:
                        s = float(item[field])
                        if s > 1.0:
                            raw_sim_int = int(round(s))
                            score = s / 100.0
                        else:
                            score = s
                            raw_sim_int = int(round(s * 100.0))
                        break
                    except Exception:
                        pass

            # --- Extract and normalize reason text
            reason = ""
            reason_fields = ['razon', 'reason', 'explanation', 'why', 'motivo']
            for field in reason_fields:
                if field in item:
                    reason = str(item[field]).strip()
                    break
            if not reason or not reason.strip():
                reason = "semantic match (AI)"
            else:
                # Clean multiple spaces
                reason = re.sub(r"\s+", " ", reason).strip()

            # --- Filter connections based on reason validity
            if not reason_ok(reason):
                logger.debug("[parser] discarded: invalid reason (8–20 words and content) (%r) id=%s", reason,
                             resolved_id)
                continue

            # Filter connections based on minimum similarity threshold
            try:
                if raw_sim_int is not None and int(raw_sim_int) < int(MIN_SIM):
                    logger.debug("[parser] filtered out by MIN_SIM: %s < %s (id=%s)", raw_sim_int, MIN_SIM, resolved_id)
                    continue
            except Exception:
                pass

            # Ensure coherent 'similarity' (0–100) even if not provided
            similarity_out = int(raw_sim_int) if raw_sim_int is not None else int(round(score * 100))

            connections.append({
                'id': resolved_id,
                'titulo': self.id_to_node[resolved_id].get('titulo', ''),
                'score': round(score, 4),
                'reason': reason,
                'similarity': similarity_out,
                'metodo': 'ia'
            })

        if not connections:
            # Fallback for UUIDs present in free text
            uuids = set(m.group(0) for m in self.uuid_pattern.finditer(response_text))
            for uid in uuids:
                if uid in self.id_to_node:
                    titulo = self.id_to_node.get(uid, {}).get('titulo', '')
                    if not titulo:
                        titulo = f"[external] {uid}"
                    connections.append({
                        "id": uid,
                        "titulo": titulo,
                        "score": 0.5,
                        "reason": "fallback: UUID present in response (no JSON)",
                        "metodo": "ia-fallback"
                    })

        if not connections:
            # Fallback for exact title (case-insensitive, uses created indices)
            low = response_text.lower()
            for title_low, node_id in self.title_to_id.items():
                if title_low and title_low in low:
                    connections.append({
                        "id": node_id,
                        "titulo": self.id_to_node[node_id].get("titulo", ""),
                        "score": 0.4,
                        "reason": "fallback: title detected in response (no JSON)",
                        "metodo": "ia-fallback"
                    })
        logger.debug("[parser] returning %d connections", len(connections))
        return connections

def analyze_ai(nota: dict, candidatos: list[dict], ids_ja_trobats: set[str]) -> list[dict]:
    """Robust AI analysis function: always returns list (can be empty), never None."""
    # 0. Filter out already processed candidates
    pendents = [c for c in candidatos if c["id"] not in ids_ja_trobats]
    if not pendents:
        return []

    time.sleep(0.5)

    # Initialize parser and helper indices
    parser = RobustAIResponseParser(pendents)
    valid_ids = {c["id"] for c in pendents}

    # 1. Build context from candidate notes
    contexto_lines = []
    for i, c in enumerate(pendents[:10], 1):
        raw_tags = c.get("tags", [])
        if isinstance(raw_tags, list):
            tag_names = []
            for t in raw_tags[:3]:
                if isinstance(t, dict):
                    tag_names.append(t.get("name", ""))
                elif isinstance(t, str):
                    tag_names.append(t)
            tags = ", ".join(filter(None, tag_names)) if tag_names else "none"
        else:
            tags = "none"

        preview = (c.get("contenido") or "")[:100]
        contexto_lines.append(
            f"{i}. [{c['id']}] {c['titulo']}\n"
            f"   Tags: {tags}\n"
            f"   Preview: {preview}..."
        )

    contexto = "\n".join(contexto_lines)

    # 2. Construct robust prompt for AI
    raw_tags = nota.get("tags", [])
    if isinstance(raw_tags, list):
        tag_names = []
        for t in raw_tags[:10]:
            if isinstance(t, dict):
                tag_names.append(t.get("name", ""))
            elif isinstance(t, str):
                tag_names.append(t)
        tags_str = ", ".join(filter(None, tag_names)) if tag_names else "none"
    else:
        tags_str = "none"

    prompt = f"""You are a JSON-only responder.

        Return raw JSON ONLY. Do NOT include code fences, backticks, or any text before/after.
        
        TASK:
        Given a SOURCE NOTE and several CANDIDATE NOTES (each candidate shows its title and [UUID] in brackets),
        return conceptual connections from the source note to candidates.
        
        OUTPUT FORMAT (array only):
        [
          {{ "id": "<UUID exactly as shown in brackets>", "similarity": 0-100, "reason": "<brief explanation>" }}
        ]
        
        CONSTRAINTS:
        - Use ONLY UUIDs appearing in the CANDIDATE NOTES headers (the text between [ and ]).
        - similarity MUST be an integer 0-100 (no percentages, no floats).
        - Include ONLY entries with similarity >= {MIN_SIM}.
        - If there are NO connections >= {MIN_SIM}, return exactly: []
        - Reason MUST be 5–25 words, concrete and human-readable. Avoid single-word labels like "Ètica".
        - Write reasons in Catalan or Spanish and mention 1–2 specific overlapping concepts/tags.
        - If any reason would be shorter than 5 words, DO NOT include that entry.
        
        SOURCE NOTE:
        Title: {nota['titulo']}
        Tags: {tags_str}
        Content preview: {(nota.get('contenido') or '')[:300]}...
        
        CANDIDATE NOTES (use the ID in brackets):
        {contexto}"""

    # 3. Execute AI call with hybrid system (Ollama -> Groq fallback)
    logger.debug("\n================ PROMPT to AI_MODEL ================\n%s\n==================================================\n", prompt)

    last_err = None
    provider_used = None

    for attempt in range(AI_MODEL_RETRIES + 1):
        try:
            # --- HYBRID AI CLIENT API ---
            # call_ai_with_fallback tries Ollama first, then Groq on failure
            response_text, provider_used = call_ai_with_fallback(prompt)
            
            if not isinstance(response_text, str):
                response_text = str(response_text)
            
            response_text = response_text.strip()

            logger.debug(
                "\n================ RAW RESPONSE (first 600) ================\n%s\n==========================================================\n",
                response_text[:600].replace("\n", "\\n")
            )

            # Robust JSON parsing
            items = _parse_ai_json_robust(response_text)

            # Normalization and filter
            out = []
            skipped_id = 0
            skipped_sim = 0
            skipped_reason = 0

            for it in items or []:
                _id_raw = str(it.get("id") or "").strip()
                _id = _strip_id(_id_raw)

                if not _id or _id not in valid_ids:
                    skipped_id += 1
                    continue

                sim = _coerce_int_0_100(it.get("similarity"))
                if sim is None or sim < MIN_SIM:
                    skipped_sim += 1
                    continue

                reason = _norm_reason(it.get("reason") or "")
                if not reason_ok(reason):
                    skipped_reason += 1
                    continue

                out.append({
                    "id": _id,
                    "score": int(sim),
                    "reason": reason
                })

            logger.debug("Parser stats: valid=%d, skipped_id=%d, skipped_sim=%d, skipped_reason=%d", 
                         len(out), skipped_id, skipped_sim, skipped_reason)

            if out:
                provider_label = f"[{provider_used}]" if provider_used else ""
                logger.info("  ✓ Found %d valid connections %s", len(out), provider_label)
                return out

            # Fallback
            connections = parser.parse_ai_response(response_text) or []

            connections = [
                c for c in connections
                if reason_ok(c.get("reason", "")) and int(
                    round(c.get("score", 0) * 100 if c.get("score", 0) <= 1 else c.get("score", 0))
                ) >= MIN_SIM
            ]

            if connections:
                logger.info("  ✓ Found %d valid connections (fallback)", len(connections))
                return connections

            if not out and not connections:
                logger.debug("  ℹ Attempt %d/%d: AI returned no valid connections. Raw preview: %s", 
                               attempt + 1, AI_MODEL_RETRIES + 1, response_text[:200].replace("\n", " "))

        except (requests.Timeout, requests.ConnectionError) as e:
            last_err = e
            if attempt < AI_MODEL_RETRIES:
                sleep_s = AI_MODEL_BACKOFF ** attempt
                logger.warning("%s call failed (attempt %d/%d): %s · retrying in %.2fs",
                               AI_MODEL_NAME, attempt + 1, AI_MODEL_RETRIES + 1, e, sleep_s)
                time.sleep(sleep_s)
                continue
            else:
                logger.error("%s call failed after %d attempts: %s",
                             AI_MODEL_NAME, AI_MODEL_RETRIES + 1, e)
                break

        except Exception as e:
            last_err = e
            if attempt < AI_MODEL_RETRIES:
                sleep_s = AI_MODEL_BACKOFF ** attempt
                logger.warning("%s error (attempt %d/%d): %s · retrying in %.2fs",
                               AI_MODEL_NAME, attempt + 1, AI_MODEL_RETRIES + 1, e, sleep_s)
                time.sleep(sleep_s)
                continue
            else:
                logger.exception("AI analysis failed: %s", e)
                break

    if last_err:
        logger.error("  ⚠ Skipping AI connections due to repeated failures. Last error: %s", last_err)
    else:
        logger.info("  ℹ AI returned no valid connections after %d attempts.", AI_MODEL_RETRIES + 1)
    return []
