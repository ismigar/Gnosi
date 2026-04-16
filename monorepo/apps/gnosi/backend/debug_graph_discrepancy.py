import sys
from pathlib import Path

# Add backend to path
BASE_DIR = Path("/Users/ismaelgarciafernandez/Projectes/monorepo/apps/gnosi")
sys.path.insert(0, str(BASE_DIR))

from backend.services.graph_service import GraphService
from backend.config.app_config import load_params

def debug():
    cfg = load_params(strict_env=False)
    print(f"Vault Path: {cfg.paths.get('VAULT')}")
    
    service = GraphService()
    graph = service.build_unified_graph()
    nodes = graph.get('nodes', [])
    edges = graph.get('edges', [])
    print(f"Graph nodes count: {len(nodes)}")
    print(f"Graph edges count: {len(edges)}")
    
    print("\nNodes Kinds:")
    kinds = {}
    for n in nodes:
        k = n.get('kind', 'unknown')
        kinds[k] = kinds.get(k, 0) + 1
    print(kinds)

if __name__ == "__main__":
    debug()
