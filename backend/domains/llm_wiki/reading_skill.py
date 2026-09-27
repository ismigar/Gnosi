"""The process-source skill's shared, versioned reading methodology.

Published by the plugin catalog and consumed verbatim by the durable worker.
Keep interpretive policy here; the worker only enforces budgets and contracts.
"""

from backend.services.agent_behavior import resource as behavior_resource

SKILL_ID = "plugin.llm-wiki.process-source"
SKILL_VERSION = "2"

INSTRUCTIONS = behavior_resource('skills/plugin.llm-wiki.process-source/SKILL.md')

MAP_CONTRACT: dict[str, object] = {"summary": "Concise map with original segment ids and caveats"}
NOTE_CONTRACT: dict[str, object] = {
    "summary": "Concise account of this reading",
    "notes": [
        {
            "title": "One idea",
            "type": "concepte",
            "body_md": "Reading note",
            "tags": [],
            "source_segment_id": "primary segment id",
            "dimensions": {},
            "citations": [{"segment_id": "original segment id", "quote": "Exact substring"}],
        }
    ],
    "coverage": [{"segment_id": "every primary segment id", "reason": "extracted or why omitted"}],
    "warnings": [],
}
REQUEST_CONTRACT: dict[str, object] = {"requests": {"segment_ids": [], "queries": []}}
