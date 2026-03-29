import asyncio
import json
import logging
from typing import Optional, Dict, Any, List
from asyncio import subprocess

log = logging.getLogger(__name__)

class MCPClientErrors:
    JSON_RPC_ERROR = -32603

class DockerMCPClient:
    """
    Client MCP simple que connecta via 'docker exec' i parla JSON-RPC sobre stdio.
    """
    def __init__(self, server_name: str, docker_cmd: List[str]):
        self.server_name = server_name
        self.docker_cmd = docker_cmd
        self.process: Optional[subprocess.Process] = None
        self._msg_id = 0
        self._pending_requests: Dict[int, asyncio.Future] = {}
        self._reader_task: Optional[asyncio.Task] = None

    async def start(self):
        """Inicia el subprocés Docker."""
        log.info(f"🔌 Connecting to MCP Server '{self.server_name}' via: {' '.join(self.docker_cmd)}")
        self.process = await asyncio.create_subprocess_exec(
            *self.docker_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        self._reader_task = asyncio.create_task(self._read_loop())
        
        # Inicialitzar protocol (handshake)
        await self.initialize()

    async def initialize(self):
        try:
            log.info(f"⏳ Initializing MCP handshake with {self.server_name}...")
            # Timeout de 5 segons per evitar bloqueig total
            response = await asyncio.wait_for(self.send_request("initialize", {
                "protocolVersion": "0.1.0",
                "capabilities": {},
                "clientInfo": {"name": "digital-brain-host", "version": "1.0"}
            }), timeout=5.0)
            log.info(f"✅ MCP Initialized ({self.server_name}): {response}")
            # Notificar que estem llestos
            await self.send_notification("notifications/initialized", {})
        except asyncio.TimeoutError:
            log.error(f"❌ MCP Initialization Timed Out for {self.server_name} after 5s. Continuing without it.")
        except Exception as e:
            log.error(f"❌ MCP Initialization Failed for {self.server_name}: {e}")

    async def stop(self):
        if self.process:
            try:
                self.process.terminate()
                await self.process.wait()
            except Exception as e:
                log.warning(f"Error stopping {self.server_name}: {e}")
        if self._reader_task:
            self._reader_task.cancel()

    async def send_request(self, method: str, params: Optional[Dict] = None) -> Any:
        self._msg_id += 1
        current_id = self._msg_id
        
        request = {
            "jsonrpc": "2.0",
            "id": current_id,
            "method": method,
            "params": params or {}
        }
        
        future = asyncio.get_event_loop().create_future()
        self._pending_requests[current_id] = future
        
        await self._send_json(request)
        return await future

    async def send_notification(self, method: str, params: Optional[Dict] = None):
        request = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params or {}
        }
        await self._send_json(request)

    async def _send_json(self, data: Dict):
        if not self.process or not self.process.stdin:
            raise RuntimeError("Process not running")
        
        json_str = json.dumps(data) + "\n"
        log.debug(f"[{self.server_name} SEND] {json_str.strip()}")
        self.process.stdin.write(json_str.encode("utf-8"))
        await self.process.stdin.drain()
        log.debug(f"[{self.server_name} DRAINED]")

    async def _read_loop(self):
        if not self.process or not self.process.stdout:
            return

        async for line in self.process.stdout:
            try:
                text = line.decode("utf-8").strip()
                if not text:
                    continue
                
                # Ignorar logs que no siguin JSON (el shim de n8n/notion ja ho filtra, però per seguretat)
                if not text.startswith("{"):
                    log.debug(f"[{self.server_name} LOG] {text}")
                    continue

                msg = json.loads(text)
                
                # Handle Response
                if "id" in msg and msg["id"] in self._pending_requests:
                    future = self._pending_requests.pop(msg["id"])
                    if "error" in msg:
                        future.set_exception(RuntimeError(f"MCP Error: {msg['error']}"))
                    else:
                        future.set_result(msg.get("result"))
                
                # Handle Notifications (Server -> Client)
                # (De moment ignorem, excepte logs)
                
            except Exception as e:
                log.error(f"Error parsing MCP message from {self.server_name}: {e}")

    async def list_tools(self):
        return await self.send_request("tools/list")

    async def call_tool(self, name: str, arguments: Dict):
        return await self.send_request("tools/call", {
            "name": name,
            "arguments": arguments
        })

class MultiServerMCPClient:
    def __init__(self, config: Dict[str, Dict]):
        self.clients: Dict[str, DockerMCPClient] = {}
        self.config = config

    async def start(self):
        for name, cfg in self.config.items():
            cmd = cfg["command"]
            args = cfg.get("args", [])
            full_cmd = [cmd] + args
            client = DockerMCPClient(name, full_cmd)
            await client.start()
            self.clients[name] = client

    async def stop(self):
        for client in self.clients.values():
            await client.stop()

    async def get_all_tools(self):
        all_tools = []
        for name, client in self.clients.items():
            try:
                tools_resp = await client.list_tools()
                tools = tools_resp.get("tools", [])
                # Prefixar nom de l'eina amb el servidor per evitar col·lisions?
                # De moment no, deixem noms originals.
                for t in tools:
                    t["server"] = name # Metadata extra
                    all_tools.append(t)
            except Exception as e:
                log.error(f"Failed to list tools for {name}: {e}")
        return all_tools

    async def call_tool(self, tool_name: str, tool_args: Dict):
        # Primer, hem de trobar qui té l'eina.
        # Això és ineficient si tenim molts servidors, hauríem de fer cache.
        # Per Fase 2, fem discovery al moment (o cache simple després).
        
        # Opció: Provar en tots (poc segur).
        # Opció: Cachejar tools a l'start.
        
        # Fem cache simple ara mateix llistant-ho tot
        tools = await self.get_all_tools()
        target_server = None
        for t in tools:
            if t["name"] == tool_name:
                target_server = t["server"]
                break
        
        if not target_server:
            raise ValueError(f"Tool {tool_name} not found in any server")
            
        return await self.clients[target_server].call_tool(tool_name, tool_args)
