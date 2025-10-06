"""Weather context via rustormy."""

from __future__ import annotations

import json
import subprocess
from typing import Any


def get_weather_context(config: dict[str, Any]) -> dict[str, str] | None:
    """Get weather context using rustormy if available.

    Calls the rustormy CLI tool with configured city and units,
    parses the JSON output, and returns a dictionary with weather data.

    Args:
        config: Configuration dictionary containing context and weather settings

    Returns:
        Dictionary with weather fields (temperature, feels_like, conditions,
        humidity, location, pressure, wind_speed) or None on error
    """
    if not config["context"]["weather"]:
        return None

    try:
        weather_config = config["weather"]
        city = weather_config.get("city")
        units = weather_config.get("units", "metric")

        if not city:
            return None

        result = subprocess.run(
            ["rustormy", "--format", "json", "--city", city, "--units", units],
            capture_output=True,
            text=True,
            timeout=5,
        )

        if result.returncode == 0:
            try:
                weather_data = json.loads(result.stdout)
                temp_unit = "°F" if units == "imperial" else "°C"
                return {
                    "temperature": f"{weather_data.get('temperature', 'N/A')}{temp_unit}",
                    "feels_like": f"{weather_data.get('feels_like', 'N/A')}{temp_unit}",
                    "conditions": weather_data.get("description", "N/A"),
                    "humidity": f"{weather_data.get('humidity', 'N/A')}%",
                    "location": weather_data.get("location_name", city),
                    "pressure": f"{weather_data.get('pressure', 'N/A')} hPa",
                    "wind_speed": weather_data.get("wind_speed", "N/A"),
                }
            except json.JSONDecodeError:
                return None

    except subprocess.TimeoutExpired:
        return None
    except FileNotFoundError:
        return None
    except Exception:
        return None

    return None
