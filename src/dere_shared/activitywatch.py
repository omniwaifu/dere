"""ActivityWatch client and context gathering."""

from __future__ import annotations

import socket
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx


class ActivityWatchClient:
    """Client for interacting with the ActivityWatch API."""

    def __init__(self, base_url: str = "http://localhost:5600"):
        """Initialize the ActivityWatch client.

        Args:
            base_url: Base URL of the ActivityWatch API server
        """
        self.base_url = base_url

    def get_events(
        self, bucket_name: str, start_time: datetime, end_time: datetime, limit: int = 200
    ) -> list[dict[str, Any]]:
        """Get events from a specific ActivityWatch bucket.

        Args:
            bucket_name: Name of the bucket to query
            start_time: Start of time range (datetime with timezone)
            end_time: End of time range (datetime with timezone)
            limit: Maximum number of events to return

        Returns:
            List of event dictionaries or empty list on error
        """
        url = f"{self.base_url}/api/0/buckets/{bucket_name}/events"
        params = {
            "start": start_time.isoformat(),
            "end": end_time.isoformat(),
            "limit": limit,
        }

        try:
            response = httpx.get(url, params=params, timeout=3)
            if response.status_code == 200:
                return response.json()
        except (httpx.ConnectError, httpx.TimeoutException):
            pass
        except Exception:
            pass

        return []

    def get_window_events(self, hostname: str, lookback_minutes: int) -> list[dict[str, Any]]:
        """Get window watcher events for the specified lookback period.

        Args:
            hostname: Hostname for bucket identification
            lookback_minutes: Minutes to look back from now

        Returns:
            List of window event dictionaries
        """
        now_utc = datetime.now(UTC)
        start_time = now_utc - timedelta(minutes=lookback_minutes)
        bucket_name = f"aw-watcher-window_{hostname}"
        return self.get_events(bucket_name, start_time, now_utc)

    def get_media_events(self, hostname: str, lookback_minutes: int) -> list[dict[str, Any]]:
        """Get media player events for the specified lookback period.

        Args:
            hostname: Hostname for bucket identification
            lookback_minutes: Minutes to look back from now

        Returns:
            List of media event dictionaries
        """
        now_utc = datetime.now(UTC)
        start_time = now_utc - timedelta(minutes=lookback_minutes)
        bucket_name = f"aw-watcher-media-player_{hostname}"
        return self.get_events(bucket_name, start_time, now_utc)

    def get_afk_events(self, hostname: str, lookback_minutes: int) -> list[dict[str, Any]]:
        """Get AFK watcher events for the specified lookback period.

        Args:
            hostname: Hostname for bucket identification
            lookback_minutes: Minutes to look back from now

        Returns:
            List of AFK event dictionaries
        """
        now_utc = datetime.now(UTC)
        start_time = now_utc - timedelta(minutes=lookback_minutes)
        bucket_name = f"aw-watcher-afk_{hostname}"
        return self.get_events(bucket_name, start_time, now_utc, limit=10)


def detect_continuous_activities(
    client: ActivityWatchClient,
    hostname: str,
    now_utc: datetime,
    initial_events: list[dict[str, Any]],
    max_duration_hours: int = 6,
) -> dict[str, dict[str, Any]]:
    """Detect continuous activities by looking back progressively.

    Identifies activities that are currently active and traces them back
    to find their true start time and total duration.

    Args:
        client: ActivityWatch client instance
        hostname: Hostname for bucket identification
        now_utc: Current UTC time
        initial_events: Recent events to analyze
        max_duration_hours: Maximum hours to look back

    Returns:
        Dictionary mapping activity keys to activity data (app, title, duration, last_seen)
    """
    continuous_activities: dict[str, dict[str, Any]] = {}

    # Find activities that are currently active (within last 2 minutes)
    recent_activities: dict[str, dict[str, Any]] = {}
    two_minutes_ago = now_utc - timedelta(minutes=2)

    for event in initial_events:
        if "data" in event:
            event_time = datetime.fromisoformat(event["timestamp"].replace("Z", "+00:00"))
            if event_time >= two_minutes_ago:
                app = event["data"].get("app", "unknown")
                title = event["data"].get("title", "")
                key = f"{app}::{title}"
                if key not in recent_activities:
                    recent_activities[key] = {
                        "app": app,
                        "title": title,
                        "last_seen": event_time,
                    }

    # For each active activity, look back to find when it really started
    max_minutes = max_duration_hours * 60
    lookback_periods = [30, 60, 120, 240, 360, 480, 720]
    lookback_periods = [p for p in lookback_periods if p <= max_minutes]

    for key, activity_info in recent_activities.items():
        app = activity_info["app"]
        title = activity_info["title"]
        total_duration = 0

        # Progressive lookback to find continuous usage
        for minutes_back in lookback_periods:
            start_time = now_utc - timedelta(minutes=minutes_back)

            # Get window events for this period
            window_events = client.get_events(f"aw-watcher-window_{hostname}", start_time, now_utc)
            media_events = client.get_events(
                f"aw-watcher-media-player_{hostname}", start_time, now_utc
            )

            # Transform media events
            for event in media_events:
                if "data" in event:
                    artist = event["data"].get("artist", "Unknown Artist")
                    track_title = event["data"].get("title", "Unknown Track")
                    player = event["data"].get("player", "Media Player")
                    event["data"]["app"] = f"{player} (Playing)"
                    event["data"]["title"] = f"{artist} - {track_title}"

            all_period_events = window_events + media_events

            # Calculate continuous duration for this specific app/title
            period_duration = 0
            for event in all_period_events:
                if "data" in event:
                    event_app = event["data"].get("app", "unknown")
                    event_title = event["data"].get("title", "")

                    if event_app == app and event_title == title:
                        period_duration += event.get("duration", 0)

            # If we found significant time in this period, update total
            if period_duration > 60:
                total_duration = period_duration
            else:
                break

        continuous_activities[key] = {
            "app": app,
            "title": title,
            "duration": total_duration,
            "last_seen": activity_info["last_seen"],
        }

    return continuous_activities


def get_activity_context(config: dict[str, Any]) -> dict[str, Any] | None:
    """Get recent activity context from ActivityWatch with continuous activity detection.

    Gathers window and media player events, detects continuous activities,
    and formats them into a context dictionary.

    Args:
        config: Configuration dictionary with context and activity settings

    Returns:
        Dictionary with recent_apps list or status string, or None on error
    """
    try:
        hostname = socket.gethostname()
        now_utc = datetime.now(UTC)

        activity_enabled = config["context"]["activity"]
        media_enabled = config["context"]["media_player"]
        lookback_minutes = config["context"]["activity_lookback_minutes"]

        if not activity_enabled and not media_enabled:
            return None

        client = ActivityWatchClient()
        start_recent = now_utc - timedelta(minutes=lookback_minutes)

        window_events = []
        media_events = []

        if activity_enabled:
            window_events = client.get_events(
                f"aw-watcher-window_{hostname}", start_recent, now_utc
            )

        if media_enabled:
            media_events = client.get_events(
                f"aw-watcher-media-player_{hostname}", start_recent, now_utc
            )

        # Transform media events to window-like format
        for event in media_events:
            if "data" in event:
                artist = event["data"].get("artist", "Unknown Artist")
                title = event["data"].get("title", "Unknown Track")
                player = event["data"].get("player", "Media Player")
                event["data"]["app"] = f"{player} (Playing)"
                event["data"]["title"] = f"{artist} - {title}"

        all_recent_events = window_events + media_events

        if all_recent_events:
            continuous_activities = detect_continuous_activities(
                client,
                hostname,
                now_utc,
                all_recent_events,
                config["context"]["activity_max_duration_hours"],
            )

            if continuous_activities:
                sorted_activities = sorted(
                    continuous_activities.items(),
                    key=lambda x: x[1]["duration"],
                    reverse=True,
                )[:2]
                activities = []

                for key, data in sorted_activities:
                    app = data["app"]
                    title = data["title"]
                    total_seconds = int(data["duration"])
                    last_seen = data["last_seen"]

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
                        if len(title) > 50:
                            title = title[:47] + "..."
                        activities.append(f"{app}: {title} ({duration_str}){status_suffix}")
                    else:
                        activities.append(f"{app} ({duration_str}){status_suffix}")

                return {"recent_apps": activities}

        # If no window or media activity, try AFK watcher as fallback
        afk_events = client.get_events(
            f"aw-watcher-afk_{hostname}", start_recent, now_utc, limit=10
        )
        if afk_events and len(afk_events) > 0:
            status = afk_events[0].get("data", {}).get("status", "unknown")
            return {"status": "Active" if status == "not-afk" else "Away"}

    except Exception:
        return None

    return None
