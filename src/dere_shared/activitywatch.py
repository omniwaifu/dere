"""ActivityWatch client and context gathering."""

from __future__ import annotations

import socket
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Any

import httpx

from dere_shared.config import load_dere_config
from dere_shared.constants import DEFAULT_ACTIVITYWATCH_URL


class ActivityWatchClient:
    """Client for interacting with the ActivityWatch API."""

    def __init__(self, base_url: str = DEFAULT_ACTIVITYWATCH_URL):
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


def _get_activitywatch_settings(config: dict[str, Any] | None = None) -> tuple[bool, str]:
    if config is None:
        config = load_dere_config()

    aw_config = config.get("activitywatch", {})
    enabled = aw_config.get("enabled", True)
    base_url = aw_config.get("url", DEFAULT_ACTIVITYWATCH_URL)
    return enabled, base_url


def classify_activity(app: str | None, title: str | None) -> str:
    """Classify activity as productive, neutral, distracted, or absent."""
    app_lower = app.lower() if app else ""
    title_lower = title.lower() if title else ""

    productive_apps = {
        "code", "cursor", "neovim", "vim", "nvim", "emacs", "jetbrains",
        "pycharm", "webstorm", "intellij", "goland", "rider", "datagrip",
        "terminal", "konsole", "alacritty", "kitty", "wezterm", "zellij", "tmux",
        "obsidian", "notion", "logseq", "zotero",
        "postman", "insomnia", "dbeaver", "pgadmin",
    }

    distracted_apps = {
        "discord", "slack", "telegram", "whatsapp", "signal",
        "twitter", "x", "reddit", "facebook", "instagram", "tiktok",
        "steam", "lutris", "heroic", "game", "gaming",
        "youtube", "twitch", "netflix", "plex",
    }

    for prod_app in productive_apps:
        if prod_app in app_lower:
            return "productive"

    for dist_app in distracted_apps:
        if dist_app in app_lower:
            return "distracted"

    if any(browser in app_lower for browser in ["firefox", "chrome", "chromium", "brave", "zen", "vivaldi"]):
        if any(site in title_lower for site in ["github", "stackoverflow", "docs", "documentation", "api", "reference"]):
            return "productive"
        if any(site in title_lower for site in ["youtube", "reddit", "twitter", "facebook", "twitch"]):
            return "distracted"
        return "neutral"

    return "neutral"


def _parse_event_time(event: dict[str, Any]) -> datetime | None:
    timestamp = event.get("timestamp")
    if not timestamp:
        return None
    try:
        return datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except Exception:
        return None


def _event_end_time(event: dict[str, Any]) -> datetime | None:
    start_time = _parse_event_time(event)
    if not start_time:
        return None
    duration_seconds = float(event.get("duration") or 0)
    return start_time + timedelta(seconds=duration_seconds)


def _window_key(event: dict[str, Any]) -> tuple[str, str]:
    data = event.get("data") or {}
    app = data.get("app") or "unknown"
    title = data.get("title") or ""
    return app, title


def _media_key(event: dict[str, Any]) -> tuple[str, str, str]:
    data = event.get("data") or {}
    player = data.get("player") or "media"
    title = data.get("title") or ""
    artist = data.get("artist") or ""
    return player, title, artist


def _summarize_window_events(
    events: list[dict[str, Any]],
    top_n: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    app_totals: dict[str, float] = {}
    title_totals: dict[tuple[str, str], float] = {}

    for event in events:
        app, title = _window_key(event)
        duration = float(event.get("duration") or 0)
        if duration <= 0:
            continue
        app_totals[app] = app_totals.get(app, 0) + duration
        title_totals[(app, title)] = title_totals.get((app, title), 0) + duration

    top_apps = [
        {"app": app, "duration_seconds": duration}
        for app, duration in sorted(app_totals.items(), key=lambda item: item[1], reverse=True)[
            :top_n
        ]
    ]
    top_titles = [
        {"app": app, "title": title, "duration_seconds": duration}
        for (app, title), duration in sorted(
            title_totals.items(), key=lambda item: item[1], reverse=True
        )[:top_n]
    ]

    return top_apps, top_titles


def _summarize_categories(events: list[dict[str, Any]]) -> tuple[dict[str, float], list[dict[str, Any]]]:
    totals: dict[str, float] = {}
    for event in events:
        app, title = _window_key(event)
        category = classify_activity(app, title)
        duration = float(event.get("duration") or 0)
        if duration <= 0:
            continue
        totals[category] = totals.get(category, 0) + duration

    top = [
        {"category": category, "duration_seconds": duration}
        for category, duration in sorted(totals.items(), key=lambda item: item[1], reverse=True)
    ]
    return totals, top


def _count_window_switches(events: list[dict[str, Any]]) -> int:
    switches = 0
    last_key = None
    sorted_events = sorted(
        [e for e in events if _parse_event_time(e) is not None],
        key=lambda e: _parse_event_time(e) or datetime.min,
    )

    for event in sorted_events:
        key = _window_key(event)
        if last_key is not None and key != last_key:
            switches += 1
        last_key = key

    return switches


def _summarize_recent_events(
    events: list[dict[str, Any]],
    limit: int,
    is_media: bool = False,
) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    sorted_events = sorted(
        [e for e in events if _parse_event_time(e) is not None],
        key=lambda e: _parse_event_time(e) or datetime.min,
    )

    for event in reversed(sorted_events[-limit:]):
        start_time = _parse_event_time(event)
        end_time = _event_end_time(event)
        duration = float(event.get("duration") or 0)
        data = event.get("data") or {}
        if is_media:
            summaries.append(
                {
                    "player": data.get("player"),
                    "artist": data.get("artist"),
                    "title": data.get("title"),
                    "start": start_time.isoformat() if start_time else None,
                    "end": end_time.isoformat() if end_time else None,
                    "duration_seconds": duration,
                }
            )
        else:
            summaries.append(
                {
                    "app": data.get("app"),
                    "title": data.get("title"),
                    "start": start_time.isoformat() if start_time else None,
                    "end": end_time.isoformat() if end_time else None,
                    "duration_seconds": duration,
                }
            )

    return summaries


def _select_current_window(
    events: list[dict[str, Any]],
    now: datetime,
    recency_seconds: int,
) -> dict[str, Any] | None:
    latest_event = None
    latest_end = None

    for event in events:
        event_end = _event_end_time(event)
        if not event_end:
            continue
        if latest_end is None or event_end > latest_end:
            latest_event = event
            latest_end = event_end

    if not latest_event or not latest_end:
        return None

    if (now - latest_end).total_seconds() > recency_seconds:
        return None

    app, title = _window_key(latest_event)
    duration_seconds = sum(
        float(event.get("duration") or 0)
        for event in events
        if _window_key(event) == (app, title)
    )

    return {
        "app": app,
        "title": title,
        "duration_seconds": duration_seconds,
        "last_seen": latest_end.isoformat(),
    }


def _select_current_media(
    events: list[dict[str, Any]],
    now: datetime,
    recency_seconds: int,
) -> dict[str, Any] | None:
    latest_event = None
    latest_end = None

    for event in events:
        event_end = _event_end_time(event)
        if not event_end:
            continue
        if latest_end is None or event_end > latest_end:
            latest_event = event
            latest_end = event_end

    if not latest_event or not latest_end:
        return None

    if (now - latest_end).total_seconds() > recency_seconds:
        return None

    player, title, artist = _media_key(latest_event)
    duration_seconds = sum(
        float(event.get("duration") or 0)
        for event in events
        if _media_key(event) == (player, title, artist)
    )

    return {
        "player": player,
        "title": title,
        "artist": artist,
        "duration_seconds": duration_seconds,
        "last_seen": latest_end.isoformat(),
    }


def _compute_afk_status(
    events: list[dict[str, Any]],
    now: datetime,
) -> tuple[bool, int]:
    latest_time = None
    latest_status = None

    for event in events:
        event_time = _parse_event_time(event)
        if not event_time:
            continue
        if latest_time is None or event_time > latest_time:
            latest_time = event_time
            latest_status = (event.get("data") or {}).get("status")

    if latest_time and latest_status == "afk":
        return True, int((now - latest_time).total_seconds())

    return False, 0


class ActivityWatchService:
    """Centralized ActivityWatch access with snapshot and summary helpers."""

    def __init__(
        self,
        base_url: str = DEFAULT_ACTIVITYWATCH_URL,
        hostname: str | None = None,
        cache_ttl_seconds: int = 0,
    ) -> None:
        self.client = ActivityWatchClient(base_url=base_url)
        self.hostname = hostname or socket.gethostname()
        self.cache_ttl_seconds = cache_ttl_seconds
        self._snapshot_cache: dict[str, Any] | None = None
        self._snapshot_cached_at: float | None = None

    @classmethod
    def from_config(
        cls, config: dict[str, Any] | None = None, cache_ttl_seconds: int = 0
    ) -> ActivityWatchService | None:
        enabled, base_url = _get_activitywatch_settings(config)
        if not enabled:
            return None
        return cls(base_url=base_url, cache_ttl_seconds=cache_ttl_seconds)

    def get_snapshot(
        self,
        lookback_minutes: int = 10,
        top_n: int = 5,
        recency_seconds: int = 120,
        include_recent: bool = False,
        recent_limit: int = 5,
    ) -> dict[str, Any]:
        now = datetime.now(UTC)

        if self.cache_ttl_seconds > 0 and self._snapshot_cache is not None:
            cached_at = self._snapshot_cached_at or 0.0
            if (now.timestamp() - cached_at) < self.cache_ttl_seconds:
                return dict(self._snapshot_cache)

        window_events = self.client.get_window_events(self.hostname, lookback_minutes)
        media_events = self.client.get_media_events(self.hostname, lookback_minutes)
        afk_events = self.client.get_afk_events(
            self.hostname,
            lookback_minutes=max(lookback_minutes, 10),
        )

        is_afk, idle_seconds = _compute_afk_status(afk_events, now)
        current_window = _select_current_window(window_events, now, recency_seconds)
        current_media = _select_current_media(media_events, now, recency_seconds)
        top_apps, top_titles = _summarize_window_events(window_events, top_n)
        category_totals, top_categories = _summarize_categories(window_events)
        window_switches = _count_window_switches(window_events)
        unique_apps = len({app for app, _ in (_window_key(e) for e in window_events)})
        unique_titles = len({title for _, title in (_window_key(e) for e in window_events)})

        focus_streak_seconds = current_window.get("duration_seconds") if current_window else 0
        media_streak_seconds = current_media.get("duration_seconds") if current_media else 0

        current_category = None
        if current_window:
            current_category = classify_activity(current_window.get("app"), current_window.get("title"))
        elif current_media:
            current_category = "neutral"

        if not window_events and not media_events and not afk_events:
            presence = "unknown"
            status = "empty"
        elif is_afk:
            presence = "passive" if current_window or current_media else "away"
            status = "ok"
        else:
            presence = "active"
            status = "ok"

        snapshot = {
            "enabled": True,
            "timestamp": now.isoformat(),
            "hostname": self.hostname,
            "lookback_minutes": lookback_minutes,
            "recency_seconds": recency_seconds,
            "presence": presence,
            "is_afk": is_afk,
            "idle_seconds": idle_seconds,
            "current_window": current_window,
            "current_media": current_media,
            "top_apps": top_apps,
            "top_titles": top_titles,
            "window_events_count": len(window_events),
            "media_events_count": len(media_events),
            "afk_events_count": len(afk_events),
            "window_switches": window_switches,
            "unique_apps": unique_apps,
            "unique_titles": unique_titles,
            "focus_streak_seconds": focus_streak_seconds,
            "media_streak_seconds": media_streak_seconds,
            "current_category": current_category,
            "category_totals": category_totals,
            "top_categories": top_categories,
            "status": status,
        }

        tokens = []
        tokens.append(f"presence:{presence}")
        if current_window:
            tokens.append(f"app:{current_window.get('app')}")
            tokens.append(f"title:{(current_window.get('title') or '')[:120]}")
        if current_media:
            tokens.append(f"media:{current_media.get('player')}")
            tokens.append(f"media_title:{(current_media.get('title') or '')[:120]}")
        for app_item in top_apps:
            tokens.append(f"app:{app_item.get('app')}")
        for title_item in top_titles:
            title = (title_item.get("title") or "")[:120]
            tokens.append(f"title:{title}")

        normalized_tokens = sorted({t.lower() for t in tokens if t})
        fingerprint_source = "|".join(normalized_tokens).encode("utf-8")
        snapshot["context_fingerprint"] = sha256(fingerprint_source).hexdigest()

        if include_recent:
            snapshot["recent_windows"] = _summarize_recent_events(
                window_events, limit=recent_limit, is_media=False
            )
            snapshot["recent_media"] = _summarize_recent_events(
                media_events, limit=recent_limit, is_media=True
            )

        if self.cache_ttl_seconds > 0:
            self._snapshot_cache = dict(snapshot)
            self._snapshot_cached_at = now.timestamp()

        return snapshot


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
            duration_seconds = float(event.get("duration") or 0)
            event_end = event_time + timedelta(seconds=duration_seconds)
            if event_end >= two_minutes_ago:
                app = event["data"].get("app", "unknown")
                title = event["data"].get("title", "")
                key = f"{app}::{title}"
                if key not in recent_activities:
                    recent_activities[key] = {
                        "app": app,
                        "title": title,
                        "last_seen": event_end,
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


def get_activity_context(
    config: dict[str, Any], last_message_time: int | None = None
) -> dict[str, Any] | None:
    """Get recent activity context from ActivityWatch with intelligent differential lookback.

    Uses differential lookback based on time since last message:
    - First message or long gap: full lookback (10 min)
    - Recent message: differential lookback (time since last, minimum 2 min)

    Args:
        config: Configuration dictionary with context and activity settings
        last_message_time: Unix timestamp of last message (None for first message)

    Returns:
        Dictionary with recent_apps list or status string, or None on error
    """
    try:
        hostname = socket.gethostname()
        now_utc = datetime.now(UTC)

        activity_enabled = config["context"]["activity"]
        media_enabled = config["context"]["media_player"]
        aw_enabled, aw_url = _get_activitywatch_settings(config)

        if not aw_enabled or (not activity_enabled and not media_enabled):
            return None

        # Calculate intelligent lookback
        differential_enabled = config["context"].get("activity_differential_enabled", True)
        full_lookback = config["context"]["activity_lookback_minutes"]

        if not differential_enabled or last_message_time is None:
            # First message or feature disabled: use full lookback
            lookback_minutes = full_lookback
        else:
            # Calculate time since last message
            current_time = int(now_utc.timestamp())
            time_since_last = current_time - last_message_time
            time_since_last_minutes = time_since_last / 60

            threshold = config["context"]["activity_full_lookback_threshold_minutes"]
            min_lookback = config["context"]["activity_min_lookback_minutes"]

            if time_since_last_minutes >= threshold:
                # Long gap: revert to full lookback
                lookback_minutes = full_lookback
            else:
                # Recent message: differential with minimum
                # Add 0.5 min buffer to catch events at boundary
                lookback_minutes = max(min_lookback, time_since_last_minutes + 0.5)

        client = ActivityWatchClient(base_url=aw_url)
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
