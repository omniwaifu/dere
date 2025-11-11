"""FastAPI server with OpenAI-compatible endpoints."""

from __future__ import annotations

import time
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger

from dere_discord.daemon import DaemonClient
from dere_shared.personalities import PersonalityLoader

from .claude_client import ObsidianClaudeClient
from .models import (
    ChatCompletionChoice,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionUsage,
    ChatMessage,
    ErrorResponse,
    VaultInfo,
)
from .prompt_loader import PromptTemplateLoader
from .vault_parser import VaultParser


class ObsidianServer:
    """FastAPI server for Obsidian QuickAdd integration."""

    def __init__(
        self,
        vault_path: Path | str,
        daemon_url: str | None = None,
        enable_sessions: bool = False,
    ):
        self.vault_path = Path(vault_path)
        self.daemon_url = daemon_url
        self.enable_sessions = enable_sessions

        # Initialize vault parser
        self.vault_parser = VaultParser(self.vault_path)

        # Initialize personality loader
        self.personality_loader = PersonalityLoader()

        # Initialize prompt template loader
        self.prompt_loader = PromptTemplateLoader()

        # Initialize daemon client if enabled
        self.daemon_client = None
        if daemon_url and enable_sessions:
            self.daemon_client = DaemonClient(base_url=daemon_url)

        # Create FastAPI app
        self.app = FastAPI(
            title="dere-obsidian",
            description="OpenAI-compatible API for Obsidian with personality-driven transformations",
            version="0.1.0",
        )

        # Add CORS middleware for Obsidian plugin
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["app://obsidian.md", "capacitor://localhost", "*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        self._setup_routes()

    def _setup_routes(self):
        """Setup FastAPI routes."""

        @self.app.get("/health")
        async def health():
            """Health check endpoint."""
            return {"status": "healthy", "vault": str(self.vault_path)}

        @self.app.get("/vault/info", response_model=VaultInfo)
        async def vault_info():
            """Get vault information."""
            context = self.vault_parser.get_vault_context()
            return VaultInfo(
                vault_path=str(self.vault_path),
                has_root_claude_md=bool(context.root_instructions),
                note_types=context.note_types,
                personalities_available=self.personality_loader.list_available(),
            )

        @self.app.get("/prompts")
        async def list_prompts():
            """List available prompt templates."""
            return {"prompts": self.prompt_loader.list_available()}

        @self.app.get("/personalities")
        async def list_personalities():
            """List available personalities."""
            return {"personalities": self.personality_loader.list_available()}

        @self.app.post("/execute-prompt")
        async def execute_prompt(request: dict):
            """Execute a prompt template with file content."""
            prompt_template = request.get("prompt_template")
            personality = request.get("personality")
            file_path = request.get("file_path")
            custom_variables = request.get("variables", {})

            if not prompt_template:
                raise HTTPException(status_code=400, detail="prompt_template is required")

            # Read file content if file_path provided
            note_content = ""
            if file_path:
                full_path = self.vault_path / file_path
                if not full_path.exists():
                    raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
                note_content = full_path.read_text()

            # Render prompt template
            try:
                rendered_prompt = self.prompt_loader.render(
                    prompt_template,
                    note_content=note_content,
                    personality=personality or "dere",
                    **custom_variables,
                )
                logger.debug(f"Rendered prompt: {rendered_prompt[:200]}...")
            except Exception as e:
                logger.exception(f"Error rendering prompt template: {e}")
                raise HTTPException(status_code=400, detail=str(e))

            # Create Claude client
            claude_client = ObsidianClaudeClient(
                vault_parser=self.vault_parser,
                personality_name=personality,
                daemon_client=self.daemon_client,
                session_id=None,  # Don't use sessions for template execution
            )

            # Query Claude
            response_text = await claude_client.query_and_receive(
                prompt=rendered_prompt,
                note_path=file_path,
                note_content=note_content,
            )

            return {"result": response_text}

        @self.app.post("/v1/chat/completions")
        @self.app.post("/chat/completions")
        async def chat_completions(request: ChatCompletionRequest):
            """OpenAI-compatible chat completions endpoint."""
            try:
                if request.stream:
                    # TODO: implement streaming
                    raise HTTPException(
                        status_code=501,
                        detail="Streaming not yet implemented",
                    )

                return await self._handle_completion(request)

            except Exception as e:
                logger.exception("Error processing chat completion request")
                return JSONResponse(
                    status_code=500,
                    content=ErrorResponse(
                        error={
                            "message": str(e),
                            "type": "server_error",
                            "code": "internal_error",
                        }
                    ).model_dump(),
                )

    async def _handle_completion(self, request: ChatCompletionRequest) -> ChatCompletionResponse:
        """Handle non-streaming completion request."""

        # Extract user message
        user_messages = [msg for msg in request.messages if msg.role == "user"]
        if not user_messages:
            raise HTTPException(status_code=400, detail="No user message found")

        user_prompt = user_messages[-1].content

        # Parse personality from model name (e.g., "tsun-claude" -> "tsun")
        # Or use custom field if provided, or None for default
        personality = request.personality
        if not personality and "-" in request.model:
            # Extract personality prefix from model name
            potential_personality = request.model.split("-")[0].lower()
            available = self.personality_loader.list_available()
            if potential_personality in available:
                personality = potential_personality
                logger.debug(
                    f"Extracted personality '{personality}' from model name '{request.model}'"
                )

        # Create session if enabled
        session_id = None
        if self.enable_sessions and self.daemon_client:
            session_id, resumed, _ = await self.daemon_client.find_or_create_session(
                working_dir=str(self.vault_path),
                personality=personality,
                max_age_hours=24,
                user_id=request.user,
            )
            logger.info(f"Session {session_id} ({'resumed' if resumed else 'created'})")

        # Create Claude client
        claude_client = ObsidianClaudeClient(
            vault_parser=self.vault_parser,
            personality_name=personality,
            daemon_client=self.daemon_client,
            session_id=session_id,
        )

        # Query Claude
        response_text = await claude_client.query_and_receive(
            prompt=user_prompt,
            note_path=request.note_path,
            note_content=request.note_content,
        )

        # Capture to daemon if session enabled
        if session_id and self.daemon_client:
            await self.daemon_client.capture_message(
                {
                    "session_id": session_id,
                    "prompt": user_prompt,
                    "message_type": "user",
                    "medium": "obsidian",
                }
            )
            await self.daemon_client.capture_message(
                {
                    "session_id": session_id,
                    "prompt": response_text,
                    "message_type": "assistant",
                    "medium": "obsidian",
                }
            )

        # Build OpenAI-compatible response
        completion_id = f"chatcmpl-{uuid.uuid4().hex[:8]}"
        created_timestamp = int(time.time())

        response = ChatCompletionResponse(
            id=completion_id,
            created=created_timestamp,
            model=request.model,
            choices=[
                ChatCompletionChoice(
                    index=0,
                    message=ChatMessage(role="assistant", content=response_text),
                    finish_reason="stop",
                )
            ],
            usage=ChatCompletionUsage(
                prompt_tokens=len(user_prompt.split()),  # Rough estimate
                completion_tokens=len(response_text.split()),
                total_tokens=len(user_prompt.split()) + len(response_text.split()),
            ),
        )

        return response

    async def shutdown(self):
        """Cleanup on shutdown."""
        if self.daemon_client:
            await self.daemon_client.close()


def create_app(
    vault_path: Path | str,
    daemon_url: str | None = None,
    enable_sessions: bool = False,
) -> FastAPI:
    """Create FastAPI application."""
    server = ObsidianServer(
        vault_path=vault_path,
        daemon_url=daemon_url,
        enable_sessions=enable_sessions,
    )
    return server.app
