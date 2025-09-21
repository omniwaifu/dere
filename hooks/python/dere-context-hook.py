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

def read_config():
    """Read the dere configuration file and return parsed config"""
    config = {
        'context': {
            'time': True,
            'weather': True,
            'activity': True,
            'media_player': True,
            'activity_lookback_minutes': 10,
            'activity_max_duration_hours': 6,
            'show_inactive_items': True,
            'update_interval_seconds': 0,
            'weather_cache_minutes': 10,
            'format': 'concise',
            'max_title_length': 50,
            'show_duration_for_short': True,
        },
        'weather': {
            'enabled': False,
            'city': None,
            'units': 'metric',
        }
    }

    config_path = os.path.expanduser("~/.config/dere/config.toml")
    if os.path.exists(config_path):
        try:
            if sys.version_info >= (3, 11):
                import tomllib
                with open(config_path, 'rb') as f:
                    toml_config = tomllib.load(f)
            else:
                # Fallback to simple parsing for older Python
                with open(config_path, 'r') as f:
                    toml_config = parse_simple_toml(f.read())

            # Update config with file values
            if 'context' in toml_config:
                config['context'].update(toml_config['context'])
            if 'weather' in toml_config:
                config['weather'].update(toml_config['weather'])

        except Exception:
            pass  # Use defaults if parsing fails

    return config

def parse_simple_toml(content):
    """Simple TOML parser for basic key=value pairs"""
    config = {'context': {}, 'weather': {}}
    current_section = None

    for line in content.split('\n'):
        line = line.strip()
        if not line or line.startswith('#'):
            continue

        if line.startswith('[') and line.endswith(']'):
            current_section = line[1:-1]
            continue

        if '=' in line and current_section in config:
            key, value = line.split('=', 1)
            key = key.strip()
            value = value.split('#')[0].strip().strip('"\'')

            # Convert values
            if value.lower() == 'true':
                value = True
            elif value.lower() == 'false':
                value = False
            elif value.isdigit():
                value = int(value)

            config[current_section][key] = value

    return config

def get_weather_context(config):
    """Get weather context using rustormy if available"""
    if not config['context']['weather']:
        return None

    try:
        weather_config = config['weather']
        city = weather_config.get('city')
        units = weather_config.get('units', 'metric')

        # Only run rustormy if we have a city configured
        if not city:
            return None

        # Run rustormy with proper arguments
        result = subprocess.run(
            ["rustormy", "--format", "json", "--city", city, "--units", units],
            capture_output=True,
            text=True,
            timeout=5  # Increased timeout for network requests
        )

        if result.returncode == 0:
            try:
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
            except json.JSONDecodeError as e:
                log_error(f"Weather JSON decode error: {e}, output: {result.stdout[:200]}")
        else:
            log_error(f"Rustormy failed with code {result.returncode}: {result.stderr[:200]}")
    except subprocess.TimeoutExpired:
        log_error("Weather request timed out")
    except FileNotFoundError:
        log_error("rustormy command not found - install from https://github.com/Tairesh/rustormy")
    except Exception as e:
        log_error(f"Weather error: {e}")
    return None

def get_events_from_bucket(hostname, bucket_suffix, start_time, end_time, limit=200):
    """Helper function to get events from a specific ActivityWatch bucket"""
    bucket_name = f"{bucket_suffix}_{hostname}"
    url = f"http://localhost:5600/api/0/buckets/{bucket_name}/events"
    params = {
        "start": start_time.isoformat(),
        "end": end_time.isoformat(),
        "limit": limit
    }

    try:
        response = requests.get(url, params=params, timeout=3)
        if response.status_code == 200:
            return response.json()
        elif response.status_code == 404:
            log_error(f"ActivityWatch bucket not found: {bucket_name}")
        else:
            log_error(f"ActivityWatch API error {response.status_code}: {bucket_name}")
    except requests.exceptions.ConnectionError:
        log_error("ActivityWatch not running - start with 'aw-qt' or 'activitywatch'")
    except requests.exceptions.Timeout:
        log_error("ActivityWatch request timed out")
    except Exception as e:
        log_error(f"ActivityWatch error for {bucket_name}: {e}")
    return []

def detect_continuous_activities(hostname, now_utc, initial_events, max_duration_hours=6):
    """Detect continuous activities by looking back progressively"""
    continuous_activities = {}

    # Find activities that are currently active (within last 2 minutes)
    recent_activities = {}
    two_minutes_ago = now_utc - timedelta(minutes=2)

    for event in initial_events:
        if 'data' in event:
            event_time = datetime.fromisoformat(event['timestamp'].replace('Z', '+00:00'))
            if event_time >= two_minutes_ago:
                app = event['data'].get('app', 'unknown')
                title = event['data'].get('title', '')
                key = f"{app}::{title}"
                if key not in recent_activities:
                    recent_activities[key] = {'app': app, 'title': title, 'last_seen': event_time}

    # For each active activity, look back to find when it really started
    # Create lookback periods up to max_duration_hours
    max_minutes = max_duration_hours * 60
    lookback_periods = [30, 60, 120, 240, 360, 480, 720]  # 30min, 1h, 2h, 4h, 6h, 8h, 12h
    lookback_periods = [p for p in lookback_periods if p <= max_minutes]

    for key, activity_info in recent_activities.items():
        app = activity_info['app']
        title = activity_info['title']
        total_duration = 0

        # Progressive lookback to find continuous usage
        for minutes_back in lookback_periods:
            start_time = now_utc - timedelta(minutes=minutes_back)

            # Get window events for this period
            window_events = get_events_from_bucket(hostname, "aw-watcher-window", start_time, now_utc)
            media_events = get_events_from_bucket(hostname, "aw-watcher-media-player", start_time, now_utc)

            # Transform media events
            for event in media_events:
                if 'data' in event:
                    artist = event['data'].get('artist', 'Unknown Artist')
                    track_title = event['data'].get('title', 'Unknown Track')
                    media_app = event['data'].get('app', 'Media Player')
                    event['data']['app'] = f"{media_app} (Playing)"
                    event['data']['title'] = f"{artist} - {track_title}"

            all_period_events = window_events + media_events

            # Calculate continuous duration for this specific app/title
            period_duration = 0
            for event in all_period_events:
                if 'data' in event:
                    event_app = event['data'].get('app', 'unknown')
                    event_title = event['data'].get('title', '')

                    if event_app == app and event_title == title:
                        period_duration += event.get('duration', 0)

            # If we found significant time in this period, update total
            if period_duration > 60:  # More than 1 minute
                total_duration = period_duration
            else:
                # If we didn't find much activity in this longer period, stop looking back
                break

        continuous_activities[key] = {
            'app': app,
            'title': title,
            'duration': total_duration,
            'last_seen': activity_info['last_seen']
        }

    return continuous_activities

def get_activity_context(config):
    """Get recent activity context from ActivityWatch with continuous activity detection"""
    try:
        # Get hostname for bucket names
        import socket
        hostname = socket.gethostname()

        # ActivityWatch expects UTC timestamps
        from datetime import timezone
        now_utc = datetime.now(timezone.utc)

        # Get activity settings from config
        activity_enabled = config['context']['activity']
        media_enabled = config['context']['media_player']
        lookback_minutes = config['context']['activity_lookback_minutes']

        if not activity_enabled and not media_enabled:
            return None

        # Get recent activity to see what's currently active
        start_recent = now_utc - timedelta(minutes=lookback_minutes)

        window_events = []
        media_events = []

        if activity_enabled:
            window_events = get_events_from_bucket(hostname, "aw-watcher-window", start_recent, now_utc)

        if media_enabled:
            media_events = get_events_from_bucket(hostname, "aw-watcher-media-player", start_recent, now_utc)

        # Transform media events to window-like format
        for event in media_events:
            if 'data' in event:
                artist = event['data'].get('artist', 'Unknown Artist')
                title = event['data'].get('title', 'Unknown Track')
                app = event['data'].get('app', 'Media Player')
                event['data']['app'] = f"{app} (Playing)"
                event['data']['title'] = f"{artist} - {title}"

        all_recent_events = window_events + media_events

        if all_recent_events:
            # Use continuous activity detection to get true durations
            continuous_activities = detect_continuous_activities(hostname, now_utc, all_recent_events, config['context']['activity_max_duration_hours'])

            if continuous_activities:
                # Sort by duration and get top 2
                sorted_activities = sorted(continuous_activities.items(),
                                         key=lambda x: x[1]['duration'], reverse=True)[:2]
                activities = []

                for key, data in sorted_activities:
                    app = data['app']
                    title = data['title']
                    total_seconds = int(data['duration'])
                    last_seen = data['last_seen']

                    # Check if still active (within last 2 minutes)
                    time_since_last = now_utc - last_seen
                    is_recent = time_since_last.total_seconds() < 120

                    # Format duration
                    hours = total_seconds // 3600
                    minutes = (total_seconds % 3600) // 60
                    seconds = total_seconds % 60

                    if hours > 0:
                        duration_str = f"{hours}h {minutes}m"
                    elif minutes > 0:
                        duration_str = f"{minutes}m {seconds}s"
                    else:
                        duration_str = f"{seconds}s"

                    # Add status indicator for inactive items
                    status_suffix = ""
                    if not is_recent:
                        if "(Playing)" in app:
                            status_suffix = " (ended)"
                        else:
                            status_suffix = " (inactive)"

                    # Format the activity string
                    if title:
                        # Truncate title if too long
                        if len(title) > 50:
                            title = title[:47] + "..."
                        activities.append(f"{app}: {title} ({duration_str}){status_suffix}")
                    else:
                        activities.append(f"{app} ({duration_str}){status_suffix}")

                return {"recent_apps": activities}

        # If no window or media activity, try AFK watcher as fallback
        afk_events = get_events_from_bucket(hostname, "aw-watcher-afk", start_recent, now_utc, limit=10)
        if afk_events and len(afk_events) > 0:
            status = afk_events[0].get('data', {}).get('status', 'unknown')
            return {"status": "Active" if status == "not-afk" else "Away"}
    except Exception as e:
        log_error(f"Activity error: {e}")
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

def log_error(message):
    """Centralized error logging with timestamp"""
    try:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open("/tmp/dere_context_hook.log", "a") as f:
            f.write(f"[{timestamp}] {message}\n")
    except Exception:
        pass  # Don't let logging errors break the hook

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
    except json.JSONDecodeError as e:
        log_error(f"JSON decode error from stdin: {e}")
        sys.exit(0)
    except Exception as e:
        log_error(f"Error reading input: {e}")
        sys.exit(0)

    # Read configuration with fallback to defaults
    try:
        config = read_config()
    except Exception as e:
        log_error(f"Config read error, using defaults: {e}")
        # Fallback to hardcoded defaults
        config = {
            'context': {
                'time': True,
                'weather': True,
                'activity': True,
                'media_player': True,
                'activity_lookback_minutes': 10,
                'activity_max_duration_hours': 6,
            },
            'weather': {
                'enabled': False,
                'city': None,
                'units': 'metric',
            }
        }

    # Get fresh context based on configuration
    context_parts = []

    try:
        if config['context']['time']:
            time_ctx = get_time_context()
            if time_ctx:
                context_parts.append(f"Current time: {time_ctx['time']}, {time_ctx['date']}")
    except Exception as e:
        log_error(f"Time context error: {e}")

    try:
        if config['context']['weather']:
            weather_ctx = get_weather_context(config)
            if weather_ctx:
                weather_str = f"Weather in {weather_ctx['location']}: {weather_ctx['conditions']}, {weather_ctx['temperature']} (feels like {weather_ctx['feels_like']}), Humidity: {weather_ctx['humidity']}, Pressure: {weather_ctx['pressure']}"
                context_parts.append(weather_str)
    except Exception as e:
        log_error(f"Weather context error: {e}")

    try:
        if config['context']['activity'] or config['context']['media_player']:
            activity_ctx = get_activity_context(config)
            if activity_ctx:
                if activity_ctx.get('recent_apps'):
                    activity_str = "Recent activity: " + ", ".join(activity_ctx['recent_apps'])
                    context_parts.append(activity_str)
                elif activity_ctx.get('status'):
                    context_parts.append(f"User status: {activity_ctx['status']}")
    except Exception as e:
        log_error(f"Activity context error: {e}")

    # Format the final context string
    if context_parts:
        context_str = " | ".join(context_parts)
        print(f"\n[Context Update: {context_str}]\n")

    sys.exit(0)

if __name__ == "__main__":
    main()