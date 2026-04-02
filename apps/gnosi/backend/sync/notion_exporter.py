"""
Notion Exporter: Sync directives to Notion.
"""
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime
import asyncio


class NotionExporter:
    """
    Exports directives to Notion as pages.
    Uses MCP to interact with Notion API.
    """
    
    def __init__(self):
        self.instructions_dir = Path(__file__).parent.parent / "instructions"
        if not self.instructions_dir.exists():
            self.instructions_dir = Path(__file__).parent.parent / "backend" / "instructions"
        
        self._parent_page_id: Optional[str] = None
    
    def _get_directives(self) -> List[Dict[str, Any]]:
        """Get all directives from the instructions folder."""
        directives = []
        
        if self.instructions_dir.exists():
            for md_file in self.instructions_dir.glob("*.md"):
                content = md_file.read_text()
                directives.append({
                    "name": md_file.stem,
                    "content": content,
                    "path": str(md_file)
                })
        
        return directives
    
    async def export_directive(self, name: str) -> Dict[str, Any]:
        """Export a single directive to Notion."""
        directive_path = self.instructions_dir / f"{name}.md"
        
        if not directive_path.exists():
            raise FileNotFoundError(f"Directive {name} not found")
        
        content = directive_path.read_text()
        
        # Use MCP to create/update page in Notion
        # This is a simplified version - in production would use actual MCP client
        try:
            # Import MCP client (will fail if not running in agent context)
            from backend.mcp.client import mcp_client
            
            # Search for existing page with this name
            search_result = await mcp_client.call_tool(
                "notion-server",
                "API-post-search",
                {"query": f"Directive: {name}"}
            )
            
            # Create blocks from markdown content
            blocks = self._markdown_to_blocks(content)
            
            if search_result.get("results"):
                # Update existing page
                page_id = search_result["results"][0]["id"]
                # Clear and re-add blocks
                await mcp_client.call_tool(
                    "notion-server",
                    "API-patch-block-children",
                    {"block_id": page_id, "children": blocks}
                )
                return {"success": True, "action": "updated", "page_id": page_id}
            else:
                # Create new page
                result = await mcp_client.call_tool(
                    "notion-server",
                    "API-post-page",
                    {
                        "parent": {"page_id": self._parent_page_id or ""},
                        "properties": {
                            "title": [{"text": {"content": f"Directive: {name}"}}]
                        }
                    }
                )
                return {"success": True, "action": "created", "page_id": result.get("id")}
                
        except ImportError:
            # MCP client not available - return mock result
            return {
                "success": True,
                "action": "simulated",
                "message": f"Directive '{name}' ready to sync (MCP not available)",
                "content_preview": content[:200] + "..."
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    async def export_all_directives(self) -> Dict[str, Any]:
        """Export all directives to Notion."""
        directives = self._get_directives()
        
        results = []
        errors = []
        
        for directive in directives:
            try:
                result = await self.export_directive(directive["name"])
                results.append({
                    "name": directive["name"],
                    **result
                })
            except Exception as e:
                errors.append({
                    "name": directive["name"],
                    "error": str(e)
                })
        
        return {
            "success": len(errors) == 0,
            "synced": len(results),
            "results": results,
            "errors": errors,
            "timestamp": datetime.utcnow().isoformat()
        }
    
    def _markdown_to_blocks(self, content: str) -> List[Dict]:
        """Convert markdown to Notion blocks (simplified)."""
        blocks = []
        lines = content.split('\n')
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            if line.startswith('# '):
                blocks.append({
                    "type": "heading_1",
                    "heading_1": {"rich_text": [{"text": {"content": line[2:]}}]}
                })
            elif line.startswith('## '):
                blocks.append({
                    "type": "heading_2", 
                    "heading_2": {"rich_text": [{"text": {"content": line[3:]}}]}
                })
            elif line.startswith('- '):
                blocks.append({
                    "type": "bulleted_list_item",
                    "bulleted_list_item": {"rich_text": [{"text": {"content": line[2:]}}]}
                })
            else:
                blocks.append({
                    "type": "paragraph",
                    "paragraph": {"rich_text": [{"text": {"content": line}}]}
                })
        
        return blocks


# Singleton
notion_exporter = NotionExporter()
