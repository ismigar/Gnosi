import asyncio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def test():
    server_params = StdioServerParameters(
        command="/usr/local/bin/uv",
        args=["run", "--directory", "/Users/ismaelgarciafernandez/Projectes/monorepo/apps/gnosi/mcp-servers/drupal-proxy", "python", "-m", "drupal_proxy.server"]
    )
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            print("Initialized!")
            res = await session.call_tool("drupal_list_categories", {})
            print("Tool result:", res)

asyncio.run(test())
