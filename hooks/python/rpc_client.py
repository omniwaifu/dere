#!/usr/bin/env python3
import json
import socket
import os
from typing import Dict, Any, Optional

class RPCClient:
    def __init__(self):
        home = os.path.expanduser("~")
        self.socket_path = os.path.join(home, ".local", "share", "dere", "daemon.sock")
        self.id_counter = 0

    def call(self, method: str, params: Optional[Dict[str, Any]] = None) -> Any:
        self.id_counter += 1
        request = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params or {},
            "id": self.id_counter
        }

        request_data = json.dumps(request)
        http_request = f"POST /rpc HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {len(request_data)}\r\n\r\n{request_data}"

        try:
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.connect(self.socket_path)
            sock.send(http_request.encode())

            response = sock.recv(4096).decode()
            sock.close()

            # Parse HTTP response
            if "\r\n\r\n" in response:
                body = response.split("\r\n\r\n", 1)[1].strip()
                if not body:
                    raise Exception("Empty response body")

                result = json.loads(body)

                if "error" in result:
                    raise Exception(f"RPC Error: {result['error']['message']}")

                return result.get("result")
            else:
                raise Exception(f"Invalid HTTP response: {response[:100]}")

        except Exception as e:
            print(f"RPC call failed: {e}")
            return None

    def capture_conversation(self, session_id: int, personality: str, project_path: str, prompt: str, message_type: str = "user") -> Any:
        return self.call("conversation.capture", {
            "session_id": session_id,
            "personality": personality,
            "project_path": project_path,
            "prompt": prompt,
            "message_type": message_type,
            "is_command": False
        })

    def capture_claude_response(self, session_id: int, personality: str, project_path: str, response: str) -> Any:
        return self.capture_conversation(session_id, personality, project_path, response, "assistant")

    def end_session(self, session_id: int, exit_reason: str = "normal") -> Any:
        return self.call("session.end", {
            "session_id": session_id,
            "exit_reason": exit_reason
        })

    def get_status(self, personality: str = "", mcp_servers: list = None, context: bool = False) -> Any:
        params = {}
        if personality:
            params["personality"] = personality
        if mcp_servers:
            params["mcp_servers"] = mcp_servers
        if context:
            params["context"] = context

        return self.call("status.get", params)