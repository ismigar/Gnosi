
import json
import time
from pathlib import Path
from pipeline.ai_client import call_ai_client
from config.app_config import load_params
from config.logger_config import get_logger

log = get_logger(__name__)
cfg = load_params(strict_env=False)

# Paths
OUT_JSON = cfg.paths["OUT_JSON"] # suggestions.json
CACHE_PATH = cfg.paths["OUT_DIR"] / "content_cache.json"

MACRO_CLUSTERS = [
    "Filosofia i Pensament",
    "Societat i Política",
    "Ciència i Tecnologia",
    "Art i Cultura",
    "Psicologia i Vida",
    "Història",
    "Economia",
    "Religió i Espiritualitat",
    "Metodología i Aprenentatge"
]

PROMPT_TEMPLATE = """
Classifica la següent nota en UN d'aquests macro-temes:
{clusters}

Si no encaixa en cap, inventa un de nou (màxim 2 paraules).
Retorna NOMÉS el nom del clúster.

Títol: {title}
Tags: {tags}
Contingut: {content}
"""

def load_json(path):
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except:
        return {}

def save_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

def augment_clusters():
    log.info(f"🧠 Debug Paths: OUT_JSON={Path(OUT_JSON).resolve()}, CACHE={CACHE_PATH.resolve()}")
    log.info("🧠 Starting AI Clustering...")
    
    # 1. Load Data
    if not Path(OUT_JSON).exists():
        log.error(f"❌ {OUT_JSON} not found. Run suggest_connections first.")
        return

    graph_data = load_json(Path(OUT_JSON))
    cache_data = load_json(CACHE_PATH)
    
    nodes = graph_data.get("nodes", [])
    updated_count = 0
    
    for node in nodes:
        nid = node["id"]
        
        # Skip if not a regular note
        if node.get("kind") == "tag" or node.get("kind") == "index":
            continue

        # Check if already has cluster in cache (Persistence)
        cached_node = cache_data.get(nid, {})
        
        if "ai_cluster" in cached_node:
            node["ai_cluster"] = cached_node["ai_cluster"]
            continue
            
        # If not, generate it
        content = cached_node.get("content", "")
        if not content:
             content = "No content available."
        
        prompt = PROMPT_TEMPLATE.format(
            clusters=", ".join(MACRO_CLUSTERS),
            title=node.get("title", ""),
            tags=", ".join([t["name"] for t in node.get("tags", [])] if isinstance(node.get("tags"), list) else []),
            content=content[:1000] 
        )
        
        try:
            # Call AI
            cluster_name = call_ai_client(prompt).strip().replace(".", "").replace('"', '')
            cluster_name = cluster_name.split("\n")[0].strip()
            
            # Save
            node["ai_cluster"] = cluster_name
            
            # Update Cache
            if nid not in cache_data:
                cache_data[nid] = {}
            cache_data[nid]["ai_cluster"] = cluster_name
            
            log.info(f"✨ Tagged: {node.get('title')} -> {cluster_name}")
            updated_count += 1
            
            # Incremental Save every 5 AI calls
            if updated_count % 5 == 0:
                save_json(CACHE_PATH, cache_data)
                save_json(Path(OUT_JSON), graph_data)
                log.info(f"💾 Protocol Saved ({updated_count} nodes)")

            time.sleep(0.1)
            
        except Exception as e:
            log.error(f"Error clustering {nid}: {e}")
            
    # Final Save back
    save_json(CACHE_PATH, cache_data)
    save_json(Path(OUT_JSON), graph_data)
    log.info(f"✅ Pipeline complete. AI calls: {updated_count}. Cache hits applied.")

if __name__ == "__main__":
    augment_clusters()
