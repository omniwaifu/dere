from __future__ import annotations

from dere_shared.llm_client import _try_parse_json_from_text, _unwrap_tool_payload


def test_unwrap_tool_payload_single_key_parameters():
    payload = {
        "parameters": {
            "reasoning": "x",
            "resulting_emotions": [{"type": "joy", "intensity": 25, "eliciting": "y"}],
        }
    }
    assert _unwrap_tool_payload(payload) == payload["parameters"]


def test_unwrap_tool_payload_name_plus_parameters():
    payload = {
        "name": "StructuredOutput",
        "parameters": {
            "reasoning": "x",
            "resulting_emotions": [{"type": "joy", "intensity": 25, "eliciting": "y"}],
        },
    }
    assert _unwrap_tool_payload(payload) == payload["parameters"]


def test_try_parse_json_from_text_whole_string():
    assert _try_parse_json_from_text('{"a": 1}') == {"a": 1}


def test_try_parse_json_from_text_embedded_object():
    text = "Here you go:\n```json\n{\"a\": 1}\n```"
    assert _try_parse_json_from_text(text) == {"a": 1}

