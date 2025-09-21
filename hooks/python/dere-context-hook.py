#!/usr/bin/env python3
"""
Dynamic context injection hook for dere.
Injects fresh time, weather, and activity context with every user message.
"""
import sys
import json
import os
import time
import subprocess
import requests
from datetime import datetime, timedelta

def get_time_context():
    """Get current time and date context"""
    from datetime import datetime
    import time

    now = datetime.now()
    # Get proper timezone abbreviation
    tz = time.strftime('%Z')

    return {
        "time": now.strftime("%H:%M:%S") + " " + tz,
        "date": now.strftime("%A, %B %d, %Y"),
        "timezone": tz,
    }

def get_weather_context():
    """Get weather context using rustormy if available"""
    try:
        # Read config to get location
        config_path = os.path.expanduser("~/.config/dere/config.toml")
        city = None  # No default - must be configured
        units = "metric"  # Default to metric like rest of world

        if os.path.exists(config_path):
            with open(config_path, 'r') as f:
                lines = f.readlines()
                in_weather = False
                for line in lines:
                    if '[weather]' in line:
                        in_weather = True
                    elif in_weather:
                        if line.startswith('['):
                            break
                        if 'city =' in line:
                            # Split by = and take the value, then split by # for comments
                            value = line.split('=')[1].split('#')[0].strip().strip('"')
                            city = value
                        elif 'units =' in line:
                            value = line.split('=')[1].split('#')[0].strip().strip('"')
                            units = value

        # Only run rustormy if we have a city configured
        if not city:
            return None

        # Run rustormy with proper arguments
        result = subprocess.run(
            ["rustormy", "--format", "json", "--city", city, "--units", units],
            capture_output=True,
            text=True,
            timeout=3
        )

        if result.returncode == 0:
            weather_data = json.loads(result.stdout)
            temp_unit = "°F" if units == "imperial" else "°C"
            return {
                "temperature": f"{weather_data.get('temperature', 'N/A')}{temp_unit}",
                "feels_like": f"{weather_data.get('feels_like', 'N/A')}{temp_unit}",
                "conditions": weather_data.get('description', 'N/A'),
                "humidity": f"{weather_data.get('humidity', 'N/A')}%",
                "location": weather_data.get('location_name', city),
                "pressure": f"{weather_data.get('pressure', 'N/A')} hPa",
                "wind_speed": weather_data.get('wind_speed', 'N/A'),
            }
    except Exception as e:
        with open("/tmp/dere_context_hook.log", "a") as f:
            f.write(f"Weather error: {e}\n")
    return None

def get_activity_context():
    """Get recent activity context from ActivityWatch if available"""
    try:
        # Get hostname for bucket names
        import socket
        hostname = socket.gethostname()

        # Query ActivityWatch API for recent window activity
        # ActivityWatch expects UTC timestamps
        from datetime import timezone
        now_utc = datetime.now(timezone.utc)
        start_utc = now_utc - timedelta(minutes=10)  # Last 10 minutes of activity

        # Try window watcher first, then fall back to AFK status
        url = f"http://localhost:5600/api/0/buckets/aw-watcher-window_{hostname}/events"
        params = {
            "start": start_utc.isoformat(),
            "end": now_utc.isoformat(),
            "limit": 50
        }

        response = requests.get(url, params=params, timeout=1)

        # Also get media player data for background audio/video
        media_url = f"http://localhost:5600/api/0/buckets/aw-watcher-media-player_{hostname}/events"
        media_response = requests.get(media_url, params=params, timeout=1)

        all_events = []
        if response.status_code == 200:
            all_events.extend(response.json())
        if media_response.status_code == 200:
            media_events = media_response.json()
            # Transform media events to look like window events
            for event in media_events:
                if 'data' in event:
                    # Use artist - title format for media
                    artist = event['data'].get('artist', 'Unknown Artist')
                    title = event['data'].get('title', 'Unknown Track')
                    app = event['data'].get('app', 'Media Player')

                    # Create a window-like event
                    event['data']['app'] = f"{app} (Playing)"
                    event['data']['title'] = f"{artist} - {title}"
            all_events.extend(media_events)

        if all_events:
            # Aggregate time by app and track titles + recency
            app_data = {}
            for event in all_events:
                if 'data' in event:
                    app = event['data'].get('app', 'unknown')
                    title = event['data'].get('title', '')
                    duration = event.get('duration', 0)
                    # Parse the event timestamp to check recency
                    event_time = datetime.fromisoformat(event['timestamp'].replace('Z', '+00:00'))

                    if app not in app_data:
                        app_data[app] = {'duration': 0, 'titles': {}, 'last_seen': event_time}

                    app_data[app]['duration'] += duration
                    # Update last_seen to the most recent event for this app
                    if event_time > app_data[app]['last_seen']:
                        app_data[app]['last_seen'] = event_time

                    # Track title with its duration
                    if title:
                        if title not in app_data[app]['titles']:
                            app_data[app]['titles'][title] = 0
                        app_data[app]['titles'][title] += duration

            # Get top 2 apps with their most used title
            if app_data:
                sorted_apps = sorted(app_data.items(), key=lambda x: x[1]['duration'], reverse=True)[:2]
                activities = []
                for app, data in sorted_apps:
                    minutes = int(data['duration'] / 60)
                    seconds = int(data['duration'] % 60)

                    # Check if this app/media is still active (last event within 2 minutes)
                    time_since_last = now_utc - data['last_seen']
                    is_recent = time_since_last.total_seconds() < 120  # 2 minutes

                    # Add status indicator for inactive items
                    status_suffix = ""
                    if not is_recent:
                        if "(Playing)" in app:
                            status_suffix = " (ended)"
                        else:
                            status_suffix = " (inactive)"

                    # Get the most used title for this app
                    if data['titles']:
                        most_used_title = max(data['titles'].items(), key=lambda x: x[1])[0]
                        # Truncate title if too long
                        if len(most_used_title) > 50:
                            most_used_title = most_used_title[:47] + "..."

                        if minutes > 0:
                            activities.append(f"{app}: {most_used_title} ({minutes}m {seconds}s){status_suffix}")
                        else:
                            activities.append(f"{app}: {most_used_title} ({seconds}s){status_suffix}")
                    else:
                        if minutes > 0:
                            activities.append(f"{app} ({minutes}m {seconds}s){status_suffix}")
                        else:
                            activities.append(f"{app} ({seconds}s){status_suffix}")

                return {"recent_apps": activities}

        # If no window or media activity, try AFK watcher as fallback
        afk_url = f"http://localhost:5600/api/0/buckets/aw-watcher-afk_{hostname}/events"
        afk_response = requests.get(afk_url, params=params, timeout=1)
        if afk_response.status_code == 200:
            afk_events = afk_response.json()
            if afk_events and len(afk_events) > 0:
                status = afk_events[0].get('data', {}).get('status', 'unknown')
                return {"status": "Active" if status == "not-afk" else "Away"}
    except Exception as e:
        with open("/tmp/dere_context_hook.log", "a") as f:
            f.write(f"Activity error: {e}\n")
    return None

def format_context(time_ctx, weather_ctx, activity_ctx):
    """Format context into a concise string"""
    parts = []

    # Time (always present)
    parts.append(f"Current time: {time_ctx['time']}, {time_ctx['date']}")

    # Weather (if available)
    if weather_ctx:
        weather_str = f"Weather in {weather_ctx['location']}: {weather_ctx['conditions']}, {weather_ctx['temperature']} (feels like {weather_ctx['feels_like']}), Humidity: {weather_ctx['humidity']}, Pressure: {weather_ctx['pressure']}"
        parts.append(weather_str)

    # Activity (if available)
    if activity_ctx:
        if activity_ctx.get('recent_apps'):
            activity_str = "Recent activity: " + ", ".join(activity_ctx['recent_apps'])
            parts.append(activity_str)
        elif activity_ctx.get('status'):
            parts.append(f"User status: {activity_ctx['status']}")

    return " | ".join(parts)

def main():
    # Only inject context if this is a dere session with context enabled
    if os.getenv("DERE_CONTEXT") != "true":
        sys.exit(0)

    # Read the input from stdin
    try:
        stdin_data = sys.stdin.read()
        if not stdin_data:
            sys.exit(0)

        input_data = json.loads(stdin_data)
    except Exception as e:
        # Log error but don't block
        with open("/tmp/dere_context_hook.log", "a") as f:
            f.write(f"Error reading input: {e}\n")
        sys.exit(0)

    # Get fresh context
    time_ctx = get_time_context()
    weather_ctx = get_weather_context()
    activity_ctx = get_activity_context()

    # Format as context string
    context_str = format_context(time_ctx, weather_ctx, activity_ctx)

    # Output the context that Claude will see
    # This gets injected before the user's prompt
    print(f"\n[Context Update: {context_str}]\n")

    sys.exit(0)

if __name__ == "__main__":
    main()