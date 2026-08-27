"""Run a manual end-to-end check against a configured Drupal instance."""

import asyncio
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main() -> None:
    """Start the proxy over stdio and call its category-listing tool."""
    server_params = StdioServerParameters(
        command="uv",
        args=[
            "run",
            "--directory",
            str(Path(__file__).resolve().parents[1]),
            "python",
            "-m",
            "drupal_proxy.server",
        ],
    )
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool("drupal_list_categories", {})
            if result.isError:
                raise RuntimeError(f"Drupal proxy smoke test failed: {result.content}")


if __name__ == "__main__":
    asyncio.run(main())
