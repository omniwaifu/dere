#!/usr/bin/env python3
"""Perform comprehensive wellness check."""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))
from config_reader import get_daemon_url


def wellness_check() -> dict:
    """Perform wellness check combining emotion and time data."""
    daemon_url = get_daemon_url()
    result = {
        "timestamp": datetime.now().isoformat(),
        "hour": datetime.now().hour,
        "is_late_night": datetime.now().hour >= 23 or datetime.now().hour < 6,
        "emotion": None,
        "risk_level": "low"
    }

    # Get emotion state
    try:
        response = requests.get(f"{daemon_url}/emotion/state", timeout=2)
        response.raise_for_status()
        emotion = response.json()
        result["emotion"] = emotion

        # Calculate risk level
        primary_intensity = emotion.get("primary", {}).get("intensity", 0)
        primary_type = emotion.get("primary", {}).get("type", "")

        if primary_intensity > 70 and primary_type in ["distress", "anger", "fear"]:
            result["risk_level"] = "high"
        elif primary_intensity > 40 and primary_type in ["distress", "anger"]:
            result["risk_level"] = "moderate"

        # Late night + negative emotion = elevated risk
        if result["is_late_night"] and result["risk_level"] != "low":
            result["risk_level"] = "high"

    except requests.exceptions.RequestException:
        pass

    return result


def main():
    """Main entry point."""
    check = wellness_check()
    print(json.dumps(check, indent=2))


if __name__ == "__main__":
    main()
