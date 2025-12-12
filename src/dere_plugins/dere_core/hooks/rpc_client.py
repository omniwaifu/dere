#!/usr/bin/env python3
import json
import os
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

# Default daemon URL (matches dere_shared.constants.DEFAULT_DAEMON_URL)
DEFAULT_DAEMON_URL = "http://localhost:8787"


class RPCClient:
    def __init__(self):
        daemon_url = os.getenv("DERE_DAEMON_URL", DEFAULT_DAEMON_URL)
        self.base_url = daemon_url.rstrip("/")

    def call(self, endpoint: str, params: dict[str, Any] | None = None) -> Any:
        """Make HTTP POST request to daemon endpoint"""
        url = f"{self.base_url}{endpoint}"
        data = json.dumps(params or {}).encode("utf-8")

        try:
            req = Request(url, data=data, headers={"Content-Type": "application/json"})
            with urlopen(req, timeout=2) as response:
                result = json.loads(response.read().decode("utf-8"))
                return result
        except (URLError, TimeoutError, ConnectionRefusedError):
            # Daemon not running - fail silently
            return None
        except Exception:
            # Other errors - fail silently
            return None

    def call_method(self, method: str, params: dict[str, Any] | None = None) -> Any:
        """Generic RPC method call - converts method name to endpoint"""
        endpoint = f"/rpc/{method}"
        return self.call(endpoint, params)

    def capture_conversation(
        self,
        session_id: int,
        personality: str,
        project_path: str,
        prompt: str,
        message_type: str = "user",
    ) -> Any:
        return self.call(
            "/conversation/capture",
            {
                "session_id": session_id,
                "personality": personality,
                "project_path": project_path,
                "prompt": prompt,
                "message_type": message_type,
                "is_command": False,
            },
        )

    def capture_claude_response(
        self, session_id: int, personality: str, project_path: str, response: str
    ) -> Any:
        return self.capture_conversation(
            session_id, personality, project_path, response, "assistant"
        )

    def end_session(self, session_id: int, exit_reason: str = "normal") -> Any:
        return self.call("/sessions/end", {"session_id": session_id})

    def get_status(
        self, personality: str = "", mcp_servers: list = None, context: bool = False
    ) -> Any:
        params = {}
        if personality:
            params["personality"] = personality
        if mcp_servers:
            params["mcp_servers"] = mcp_servers
        if context:
            params["context"] = context

        return self.call("/status/get", params)
