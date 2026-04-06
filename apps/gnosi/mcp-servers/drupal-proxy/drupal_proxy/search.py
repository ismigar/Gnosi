from typing import List, Dict, Any
from thefuzz import process, fuzz

class ToolSearcher:
    def __init__(self, config: dict):
        self.config = config.get('search', {})
        self.default_threshold = self.config.get('fuzzy_threshold', 60)
        self.default_limit = self.config.get('max_results', 10)

    def search(self, query: str, tools: List[Any]) -> List[Dict[str, Any]]:
        """
        Search for tools matching the query using fuzzy logic.
        Searches in both name and description.
        """
        if not tools:
            return []

        # Prepare choices: list of strings or dicts to search against
        # We'll create a composite string for searching: "name: description"
        choices = {}
        for tool in tools:
            # Handle both object (pydantic model) and dict access
            name = tool.name if hasattr(tool, 'name') else tool.get('name')
            desc = tool.description if hasattr(tool, 'description') else tool.get('description', '')
            
            search_str = f"{name} {desc}"
            choices[name] = search_str

        # Perform fuzzy search
        results = process.extract(
            query, 
            choices, 
            scorer=fuzz.token_set_ratio, 
            limit=self.default_limit
        )

        matched_tools = []
        for match_str, score, key in results:
            if score < self.default_threshold:
                continue
                
            # Find original tool object
            tool_obj = next((t for t in tools if (t.name if hasattr(t, 'name') else t.get('name')) == key), None)
            if tool_obj:
                matched_tools.append({
                    "tool": tool_obj,
                    "score": score
                })

        return matched_tools
