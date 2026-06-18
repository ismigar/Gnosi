import json
import re

# Read the dump
try:
    with open("workflow_dump.json", "r", errors="ignore") as f:
        content = f.read()

    # We want to find "type": "n8n-nodes-base.notion"
    # and "operation": "create" (usually inside parameters? No, resource: page, operation: create)
    
    # Let's find all names of Notion nodes.
    # Regex to find "name": "Value", ... "type": "n8n-nodes-base.notion"
    # Since JSON properties order is not guaranteed, it's safer to find all objects containing "type": "n8n-nodes-base.notion"
    
    # We will search for all occurrences of "n8n-nodes-base.notion" and extract the name around it.
    
    indices = [m.start() for m in re.finditer('"n8n-nodes-base.notion"', content)]
    
    print(f"Found {len(indices)} Notion nodes.")
    
    for idx in indices:
        # Search backwards for "name"
        name_key_pos = content.rfind('"name"', 0, idx)
        if name_key_pos != -1:
            # Extract name
            start_quote = content.find('"', name_key_pos + 7)
            end_quote = content.find('"', start_quote + 1)
            name = content[start_quote+1:end_quote]
            print(f"Notion Node: {name}")

except Exception as e:
    print(e)
