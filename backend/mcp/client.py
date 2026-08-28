"""Async JSON-RPC client and multi-server routing for stdio MCP connectors."""

import asyncio
from collections.abc import Coroutine
import json
import logging
from asyncio import subprocess
from typing import Any, cast

log = logging.getLogger(__name__)


class MCPClientErrors:
    JSON_RPC_ERROR = -32603


class DockerMCPClient:
    """
    Simple MCP client that connects via 'docker exec' and speaks JSON-RPC over stdio.

    """

    def __init__(self, server_name: str, docker_cmd: list[str]) -> None:
        self.server_name = server_name
        self.docker_cmd = docker_cmd
        self.process: subprocess.Process | None = None
        self._msg_id = 0
        self._pending_requests: dict[int, asyncio.Future[Any]] = {}
        self._reader_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Starts the Docker subprocess."""
        log.info(
            f"🔌 Connecting to MCP Server '{self.server_name}' via: {' '.join(self.docker_cmd)}"
        )
        self.process = await asyncio.create_subprocess_exec(
            *self.docker_cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        self._reader_task = asyncio.create_task(self._read_loop())

        # Initialize the protocol handshake.
        await self.initialize()

    async def initialize(self) -> None:
        try:
            log.info(f"⏳ Initializing MCP handshake with {self.server_name}...")
            # Timeout reduced to 2 seconds for total independence
            response = await asyncio.wait_for(
                self.send_request(
                    "initialize",
                    {
                        "protocolVersion": "0.1.0",
                        "capabilities": {},
                        "clientInfo": {"name": "gnosi-host", "version": "1.0"},
                    },
                ),
                timeout=2.0,
            )
            log.info(f"✅ MCP Initialized ({self.server_name}): {response}")
            # Notify that we're ready
            await self.send_notification("notifications/initialized", {})
        except asyncio.TimeoutError:
            log.error(
                f"❌ MCP Initialization Timed Out for {self.server_name} after 2s. Continuing without it."
            )
        except Exception as e:
            log.error(f"❌ MCP Initialization Failed for {self.server_name}: {e}")

    async def stop(self) -> None:
        if self.process:
            try:
                self.process.terminate()
                await self.process.wait()
            except Exception as e:
                log.warning(f"Error stopping {self.server_name}: {e}")
        if self._reader_task:
            self._reader_task.cancel()

    async def send_request(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        timeout: float = 30.0,
    ) -> Any:
        self._msg_id += 1
        current_id = self._msg_id

        request = {"jsonrpc": "2.0", "id": current_id, "method": method, "params": params or {}}

        # get_running_loop() is the modern API inside async functions
        # (get_event_loop has been deprecated since Python 3.10).
        future = asyncio.get_running_loop().create_future()
        self._pending_requests[current_id] = future

        await self._send_json(request)
        try:
            # Timeout: if the MCP server hangs or crashes, previously
            # `await future` would hang indefinitely and block
            # the caller (typically an agent_routes or factory endpoint).
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            # We clean up the pending task so it doesn't accumulate memory
            self._pending_requests.pop(current_id, None)
            raise RuntimeError(
                f"MCP request {method} on {self.server_name} timed out after {timeout}s"
            )

    async def send_notification(self, method: str, params: dict[str, Any] | None = None) -> None:
        request = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        await self._send_json(request)

    async def _send_json(self, data: dict[str, Any]) -> None:
        if not self.process:
            raise RuntimeError(f"Server {self.server_name} process not created")
        if self.process.returncode is not None:
            raise RuntimeError(
                f"Server {self.server_name} process terminated with code {self.process.returncode}"
            )
        if not self.process.stdin:
            raise RuntimeError(f"Server {self.server_name} has no stdin")

        json_str = json.dumps(data) + "\n"
        log.debug(f"[{self.server_name} SEND] {json_str.strip()}")
        self.process.stdin.write(json_str.encode("utf-8"))
        await self.process.stdin.drain()
        log.debug(f"[{self.server_name} DRAINED]")

    async def _read_loop(self) -> None:
        if not self.process or not self.process.stdout:
            return

        async for line in self.process.stdout:
            try:
                text = line.decode("utf-8").strip()
                if not text:
                    continue

                # Ignore logs that aren't JSON (the n8n/notion shim already filters this, but just to be safe)
                if not text.startswith("{"):
                    log.debug(f"[{self.server_name} LOG] {text}")
                    continue

                decoded = json.loads(text)
                if not isinstance(decoded, dict):
                    log.warning("Ignoring non-object MCP message from %s", self.server_name)
                    continue
                msg = cast(dict[str, Any], decoded)

                # Handle Response
                if "id" in msg and msg["id"] in self._pending_requests:
                    future = self._pending_requests.pop(msg["id"])
                    if "error" in msg:
                        future.set_exception(RuntimeError(f"MCP Error: {msg['error']}"))
                    else:
                        future.set_result(msg.get("result"))

                # Handle Notifications (Server -> Client)
                # (For now we ignore it, except for logs)

            except Exception as e:
                log.error(f"Error parsing MCP message from {self.server_name}: {e}")

    async def list_tools(self) -> dict[str, Any]:
        response = await self.send_request("tools/list")
        if not isinstance(response, dict):
            raise RuntimeError(
                f"MCP server {self.server_name} returned an invalid tools/list response"
            )
        return cast(dict[str, Any], response)

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        return await self.send_request("tools/call", {"name": name, "arguments": arguments})


async def _docker_container_running(name: str) -> bool:
    """True if the docker container `name` is running.

    Silent if docker is not accessible (returns False)."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "docker",
            "inspect",
            "-f",
            "{{.State.Running}}",
            name,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=5.0)
        return out.strip() == b"true"
    except Exception:
        return False


class MultiServerMCPClient:
    def __init__(self, config: dict[str, dict[str, Any]]) -> None:
        self.clients: dict[str, DockerMCPClient] = {}
        self.config = config
        # Tool→server routing cache. Previously `call_tool` called
        # `get_all_tools()` on EVERY invocation (a `tools/list` round-trip per
        # MCP server) just to find out who has the tool → multiplied latency
        # for every agent call. Now it's resolved from the cache; it only refreshes
        # on a MISS (new tool, server started later).
        self._tool_server_cache: dict[str, str] = {}
        self._health_cache: dict[str, dict[str, Any]] = {}
        self._health_checked_at = 0.0

    async def start(self) -> None:
        # Start all servers in parallel to avoid blocking the App's startup
        tasks: list[Coroutine[Any, Any, None]] = []
        for name, cfg in self.config.items():
            cmd = cfg["command"]
            args = cfg.get("args", [])
            full_cmd = [cmd] + args

            # If it's an MCP via `docker exec -i <container>`, check that the
            # container exists before connecting. Without this, if the service
            # (e.g. n8n-mcp) is not deployed, every startup would lose 2s on a
            # handshake that always timed out and filled the logs with errors.
            if cmd == "docker" and len(args) >= 3 and args[0] == "exec":
                container = args[2]
                if not await _docker_container_running(container):
                    log.info(
                        f"⏭️  MCP '{name}': container '{container}' is not active; "
                        "skipping (it will connect when deployed)."
                    )
                    continue

            client = DockerMCPClient(name, full_cmd)
            self.clients[name] = client
            tasks.append(client.start())

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def stop(self) -> None:
        for client in self.clients.values():
            await client.stop()

    async def get_all_tools(self) -> list[dict[str, Any]]:
        all_tools: list[dict[str, Any]] = []
        for name, client in self.clients.items():
            try:
                if not client.process or client.process.returncode is not None:
                    continue
                tools_resp = await client.list_tools()
                raw_tools = tools_resp.get("tools", [])
                tools = raw_tools if isinstance(raw_tools, list) else []
                # Prefix the tool name with the server to avoid collisions?
                # Not for now, we keep the original names.
                for raw_tool in tools:
                    if not isinstance(raw_tool, dict):
                        continue
                    t = cast(dict[str, Any], raw_tool)
                    t["server"] = name  # Metadata extra
                    all_tools.append(t)
            except Exception as e:
                log.error(f"Failed to list tools for {name}: {e}")
        return all_tools

    async def health_snapshot(self, *, force: bool = False) -> list[dict[str, Any]]:
        """Return connector readiness without re-listing tools on every turn."""
        now = asyncio.get_running_loop().time()
        if self._health_cache and not force and now - self._health_checked_at < 30:
            return list(self._health_cache.values())
        snapshot: dict[str, dict[str, Any]] = {}
        for name, client in self.clients.items():
            running = bool(client.process and client.process.returncode is None)
            snapshot[name] = {
                "server": name,
                "status": "healthy" if running else "unavailable",
                "reason": "process_ready" if running else "process_not_running",
            }
        self._health_cache = snapshot
        self._health_checked_at = now
        return list(snapshot.values())

    async def _refresh_tool_routing(self) -> None:
        """Rebuilds the tool→server cache by listing all tools once."""
        tools = await self.get_all_tools()
        self._tool_server_cache = {
            t["name"]: t["server"] for t in tools if t.get("name") and t.get("server")
        }

    async def call_tool(self, tool_name: str, tool_args: dict[str, Any]) -> Any:
        # Fast path: the cache already knows which server has the tool (O(1), without
        # an extra round-trip). Miss (unknown tool or server no longer present) →
        # refreshes the routing ONCE and retries before giving up.
        target_server = self._tool_server_cache.get(tool_name)
        if target_server is None or target_server not in self.clients:
            await self._refresh_tool_routing()
            target_server = self._tool_server_cache.get(tool_name)

        if not target_server or target_server not in self.clients:
            raise ValueError(f"Tool {tool_name} not found in any server")

        return await self.clients[target_server].call_tool(tool_name, tool_args)

    async def call_server_tool(
        self,
        server_name: str,
        tool_name: str,
        tool_args: dict[str, Any],
    ) -> Any:
        """Call a tool on one explicit server without ambiguous name routing."""

        client = self.clients.get(server_name)
        if client is None or not client.process or client.process.returncode is not None:
            raise ValueError(f"MCP server {server_name!r} is unavailable")
        return await client.call_tool(tool_name, tool_args)
