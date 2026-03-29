# src/data-pipeline/filter_graph.py

def _evidence(e) -> set[str]:
    ev = e.get("evidence", [])
    if isinstance(ev, str):
        ev = [ev]
    return {str(x).lower().strip() for x in ev if x}



from typing import Any, Dict

def normalize_notion_tags(tags):
    out = []
    for t in tags or []:
        # Standard Notion case
        if isinstance(t, dict):
            name = str(t.get("name", "")).strip()
            if name:  # only accept non-empty names
                out.append({
                    "name": name,
                    "color": str(t.get("color", "default"))
                })
            continue

        # case tags as strings
        if isinstance(t, str):
            name = t.strip()
            if name:
                out.append({"name": name, "color": "default"})
            continue

    return out

def filter_graph(data: Dict[str, Any], filters: Dict[str, Any] = None) -> tuple[list, list]:
    """
    Performs basic graph cleanup for static generation (Sigma).
    
    This function focuses on removing "pure" tag edges that lack other supporting evidence,
    ensuring a cleaner graph visualization. Dynamic filters (search, projects, kinds) are
    handled by the frontend.
    """
    nodes = data.get("nodes", [])
    edges = data.get("edges", [])

    # 1. Nodes: Pass all (visual filtering is handled in the frontend)
    filtered_nodes = nodes
    
    # 2. Edges: Remove noise
    filtered_edges = []
    for e in edges:
        ev = [x.lower() for x in (e.get("evidence") or [])]
        ev_set = set(ev)
        
        # 1. Remove tag-to-tag connections (both source and target are tag nodes)
        source_is_tag = e.get("source", "").startswith("tag::")
        target_is_tag = e.get("target", "").startswith("tag::")
        if source_is_tag and target_is_tag:
            continue  # Skip tag-to-tag edges
        
        # 2. Remove pure tag coincidence edges
        # These are edges created ONLY because notes share tags, with NO explicit or AI evidence
        # Pattern: evidence contains 'tags_inferred' but NOT 'explicit' or 'ai'
        if 'tags_inferred' in ev_set and not ('explicit' in ev_set or 'ai' in ev_set):
            continue  # Skip tag coincidence without other evidence
        
        # 3. Keep tag-to-note connections (evidence=['tag'])
        # These connect notes to their tag nodes for visual grouping
        
        filtered_edges.append(e)

    removed = len(edges) - len(filtered_edges)
    print(f"🧠 DEBUG filter_graph (Smart Cleanup):")
    print(f"   Nodes input: {len(nodes)}, output: {len(filtered_nodes)}")
    print(f"   Edges input: {len(edges)}, output: {len(filtered_edges)}")
    print(f"   🗑️  Removed {removed} noisy edges ({removed/len(edges)*100:.1f}%)")

    return filtered_nodes, filtered_edges
