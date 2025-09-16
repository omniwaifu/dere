#!/usr/bin/env python3
"""
Dere conversation embedding capture hook
Captures user prompts and generates embeddings via Ollama
"""

import json
import sys
import os
import sqlite3
import requests
import time
from pathlib import Path
from typing import Optional, List

# Find and load valid configuration file
import glob
import psutil

def find_valid_config():
    """Find a valid dere config file with live PID"""
    config_dir = os.path.expanduser("~/.config/dere/.claude")
    config_files = glob.glob(os.path.join(config_dir, "hook_env_*.json"))
    
    for config_file in config_files:
        try:
            with open(config_file, 'r') as f:
                data = json.load(f)
                pid = data.get('pid')
                
                # Check if PID is still alive
                if pid and psutil.pid_exists(pid):
                    try:
                        proc = psutil.Process(pid)
                        # Check if it's a dere or claude process
                        cmdline = ' '.join(proc.cmdline()).lower()
                        if 'dere' in cmdline or 'claude' in cmdline:
                            return data, config_file
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass
                
                # PID is dead, clean up the file
                try:
                    os.remove(config_file)
                except:
                    pass
        except (json.JSONDecodeError, IOError):
            # Invalid config file, try to clean up
            try:
                os.remove(config_file)
            except:
                pass
    
    # Also check for old generic config (backwards compatibility)
    old_config_path = os.path.expanduser("~/.config/dere/.claude/hook_env.json")
    if os.path.exists(old_config_path):
        try:
            with open(old_config_path, 'r') as f:
                return json.load(f), old_config_path
        except:
            pass
    
    return None, None

# Load configuration
config_data, config_path = find_valid_config()
if config_data is None:
    # No valid dere session, exit immediately
    sys.exit(0)

# Configuration from validated config file
OLLAMA_URL = config_data.get("ollama_url", "http://localhost:11434")
OLLAMA_MODEL = config_data.get("ollama_model", "mxbai-embed-large")
SUMMARIZATION_MODEL = config_data.get("summarization_model", "gemma3n:latest")
SUMMARIZATION_THRESHOLD = config_data.get("summarization_threshold", 500)
DB_PATH = config_data.get("db_path", os.path.expanduser("~/.local/share/dere/conversations.db"))
PERSONALITY = config_data.get("personality", "unknown")

def ensure_database():
    """Create database and tables if they don't exist"""
    db_dir = os.path.dirname(DB_PATH)
    os.makedirs(db_dir, exist_ok=True)
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            project_path TEXT,
            personality TEXT,
            prompt TEXT,
            embedding_text TEXT,
            processing_mode TEXT,
            prompt_embedding BLOB,
            timestamp INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_session 
        ON conversations(session_id)
    """)
    
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_project
        ON conversations(project_path)
    """)
    
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_personality 
        ON conversations(personality)
    """)
    
    conn.commit()
    conn.close()

def summarize_with_gemma(text: str, mode: str = "extract") -> Optional[str]:
    """Use gemma3n to extract semantic essence from message"""
    try:
        if mode == "light":
            prompt = f"""Briefly summarize this message, preserving key technical terms and the user's main question.
Keep it under 100 words. Focus on what the user is asking about.

Message: {text}

Summary:"""
        else:  # extract mode
            prompt = f"""Analyze this conversation message and output ONLY:
1. The user's actual question or request (one line)
2. Topics from any included content (keywords only)
3. Content type if pasted (article/code/log/data)

Be extremely concise. Optimize for semantic search, not readability.

Message: {text}

Output:"""
        
        response = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": SUMMARIZATION_MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.3,
                    "num_predict": 150
                }
            },
            timeout=2.0  # Fast timeout, fall back to direct embedding if slow
        )
        
        if response.status_code == 200:
            return response.json().get("response", "").strip()
    except Exception as e:
        # Log but don't fail
        with open("/tmp/dere_hook_debug.log", "a") as f:
            f.write(f"Summarization failed: {e}\n")
    
    return None

def process_for_embedding(text: str) -> tuple[str, str]:
    """Process message for optimal embedding
    Returns: (processed_text, processing_mode)
    """
    char_count = len(text)
    
    if char_count < SUMMARIZATION_THRESHOLD:
        # Short message, embed directly
        return text, "direct"
    
    # Try to summarize
    if char_count < 2000:
        mode = "light"
    else:
        mode = "extract"
    
    summary = summarize_with_gemma(text, mode)
    
    if summary:
        # Include length indicator for context
        processed = f"{summary} [Original: {char_count} chars]"
        return processed, mode
    else:
        # Fallback to truncation if summarization fails
        if char_count > 5000:
            # For very long text, take beginning and end
            truncated = text[:2000] + "\n[...truncated...]\n" + text[-500:]
            return truncated, "truncated"
        return text, "direct"

def get_embedding(text: str) -> Optional[List[float]]:
    """Get embedding from Ollama"""
    try:
        response = requests.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": OLLAMA_MODEL, "prompt": text},
            timeout=10
        )
        if response.status_code == 200:
            return response.json().get("embedding")
    except Exception as e:
        print(f"Failed to get embedding: {e}", file=sys.stderr)
    return None

def store_conversation(session_id: str, project_path: str, prompt: str, 
                      embedding_text: str, processing_mode: str, 
                      embedding: Optional[List[float]]):
    """Store conversation with embedding in database"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Convert embedding to F32_BLOB format (little-endian bytes)
    embedding_bytes = None
    if embedding:
        import struct
        # Pack as little-endian float32 for Turso F32_BLOB compatibility
        embedding_bytes = struct.pack(f"<{len(embedding)}f", *embedding)
    
    cursor.execute("""
        INSERT INTO conversations (session_id, project_path, personality, prompt, 
                                 embedding_text, processing_mode, prompt_embedding, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (session_id, project_path, PERSONALITY, prompt, 
          embedding_text, processing_mode, embedding_bytes, int(time.time())))
    
    conn.commit()
    conn.close()

def main():
    # Debug: Log configuration and input
    debug_log = "/tmp/dere_hook_debug.log"
    try:
        with open(debug_log, "a") as f:
            f.write(f"\n--- Hook called at {time.ctime()} ---\n")
            if config_path:
                f.write(f"Config loaded from: {config_path}\n")
                f.write(f"PID: {config_data.get('pid', 'N/A')}\n")
                f.write(f"Personality: {PERSONALITY}\n")
                f.write(f"Ollama URL: {OLLAMA_URL}\n")
            else:
                f.write("No valid config found - exiting\n")
    except Exception as e:
        # Even if debug fails, continue
        pass
    
    # Parse hook input
    hook_input = json.loads(sys.stdin.read())
    
    # Log the input
    try:
        with open(debug_log, "a") as f:
            f.write(f"Hook input: {json.dumps(hook_input, indent=2)}\n")
    except:
        pass
    
    # Extract relevant data
    transcript_path = hook_input.get("transcript_path")
    session_id = hook_input.get("session_id", "unknown")
    project_path = hook_input.get("cwd", "")  # Get current working directory
    
    # The UserPromptSubmit hook provides the prompt directly
    last_user_message = hook_input.get("prompt", "")
    
    # If no prompt in hook input, try reading from transcript
    if not last_user_message and transcript_path and os.path.exists(transcript_path):
        try:
            with open(transcript_path, 'r') as f:
                for line in f:
                    try:
                        entry = json.loads(line)
                        if entry.get("type") == "user":
                            msg = entry.get("message", {})
                            if isinstance(msg, dict):
                                last_user_message = msg.get("content", "")
                    except json.JSONDecodeError:
                        continue
        except Exception as e:
            print(f"Failed to read transcript: {e}", file=sys.stderr)
            return 0  # Don't block on error
    
    if last_user_message:
        # Ensure database exists
        ensure_database()
        
        # Process message for optimal embedding
        processed_text, processing_mode = process_for_embedding(last_user_message)
        
        # Get embedding of processed text
        embedding = get_embedding(processed_text)
        
        # Store in database with both original and processed text
        store_conversation(session_id, project_path, last_user_message, 
                         processed_text, processing_mode, embedding)
        
        # Debug log the processing
        try:
            with open(debug_log, "a") as f:
                f.write(f"Processing mode: {processing_mode}\n")
                f.write(f"Original length: {len(last_user_message)}\n")
                f.write(f"Processed length: {len(processed_text)}\n")
        except:
            pass
    
    # Always return 0 to continue
    return 0

if __name__ == "__main__":
    sys.exit(main())