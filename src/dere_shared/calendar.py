"""Calendar utilities for Google Calendar integration."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any


def get_calendar_context(
    events: list[dict[str, Any]] | None = None,
    limit: int = 5,
    hours_ahead: int = 24,
) -> str | None:
    """Format calendar events into context string.

    Args:
        events: List of calendar event dictionaries from MCP
        limit: Maximum number of events to include
        hours_ahead: How many hours ahead to consider

    Returns:
        Formatted calendar context string or None
    """
    if not events:
        return None

    context_lines = []
    now = datetime.now()
    cutoff = now + timedelta(hours=hours_ahead)

    relevant_events = []
    for event in events[:limit]:
        # Parse event time
        start_str = event.get("start", {}).get("dateTime") or event.get("start", {}).get("date")
        if not start_str:
            continue

        try:
            # Try parsing ISO format
            if "T" in start_str:
                start_time = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            else:
                # All-day event
                start_time = datetime.fromisoformat(start_str)
        except (ValueError, AttributeError):
            continue

        if start_time > cutoff:
            continue

        relevant_events.append((start_time, event))

    if not relevant_events:
        return None

    # Sort by time
    relevant_events.sort(key=lambda x: x[0])

    context_lines.append("Upcoming calendar events:")
    for start_time, event in relevant_events:
        title = event.get("summary", "Untitled")
        time_str = format_event_time(start_time, now)
        context_lines.append(f"  • {time_str}: {title}")

    return "\n".join(context_lines)


def format_event_time(event_time: datetime, reference_time: datetime | None = None) -> str:
    """Format event time relative to reference time.

    Args:
        event_time: The event datetime
        reference_time: Reference datetime (default: now)

    Returns:
        Human-readable time string
    """
    if reference_time is None:
        reference_time = datetime.now()

    delta = event_time - reference_time

    # If it's today
    if event_time.date() == reference_time.date():
        if delta.total_seconds() < 3600:  # Less than 1 hour
            minutes = int(delta.total_seconds() / 60)
            if minutes <= 0:
                return "Now"
            return f"In {minutes}min"
        return f"Today {event_time.strftime('%H:%M')}"

    # If it's tomorrow
    if event_time.date() == (reference_time + timedelta(days=1)).date():
        return f"Tomorrow {event_time.strftime('%H:%M')}"

    # If it's this week
    if delta.days < 7:
        return event_time.strftime("%A %H:%M")

    # Otherwise
    return event_time.strftime("%b %d %H:%M")


def format_event_details(event: dict[str, Any]) -> str:
    """Format full event details for display.

    Args:
        event: Event dictionary from MCP

    Returns:
        Formatted event details
    """
    lines = []

    # Title
    title = event.get("summary", "Untitled Event")
    lines.append(f"**{title}**")

    # Time
    start = event.get("start", {}).get("dateTime") or event.get("start", {}).get("date")
    end = event.get("end", {}).get("dateTime") or event.get("end", {}).get("date")

    if start:
        try:
            if "T" in start:
                start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
                if end and "T" in end:
                    end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
                    lines.append(f"Time: {start_dt.strftime('%Y-%m-%d %H:%M')} - {end_dt.strftime('%H:%M')}")
                else:
                    lines.append(f"Time: {start_dt.strftime('%Y-%m-%d %H:%M')}")
            else:
                lines.append(f"Date: {start} (All day)")
        except (ValueError, AttributeError):
            lines.append(f"Time: {start}")

    # Description
    description = event.get("description")
    if description:
        lines.append(f"Description: {description}")

    # Location
    location = event.get("location")
    if location:
        lines.append(f"Location: {location}")

    # Attendees
    attendees = event.get("attendees", [])
    if attendees:
        attendee_names = [a.get("email", "Unknown") for a in attendees]
        lines.append(f"Attendees: {', '.join(attendee_names)}")

    return "\n".join(lines)


def parse_natural_time(time_str: str, reference_time: datetime | None = None) -> datetime | None:
    """Parse natural language time strings.

    Args:
        time_str: Natural language time (e.g., "2pm", "tomorrow 3pm", "next monday 10am")
        reference_time: Reference datetime (default: now)

    Returns:
        Parsed datetime or None if parsing fails
    """
    if reference_time is None:
        reference_time = datetime.now()

    time_str = time_str.lower().strip()

    # Simple hour parsing (e.g., "2pm", "14:00")
    if "pm" in time_str or "am" in time_str:
        try:
            parsed = datetime.strptime(time_str, "%I%p")
            result = reference_time.replace(
                hour=parsed.hour,
                minute=0,
                second=0,
                microsecond=0,
            )
            return result
        except ValueError:
            pass

    # TODO: Add more sophisticated parsing (tomorrow, next week, etc.)
    # For now, return None for unparsed strings
    return None


def find_free_slots(
    events: list[dict[str, Any]],
    duration_minutes: int = 60,
    days_ahead: int = 7,
    work_hours: tuple[int, int] = (9, 17),
) -> list[tuple[datetime, datetime]]:
    """Find free time slots in calendar.

    Args:
        events: List of calendar events from MCP
        duration_minutes: Minimum slot duration in minutes
        days_ahead: How many days ahead to search
        work_hours: Tuple of (start_hour, end_hour) for work hours

    Returns:
        List of (start, end) datetime tuples for free slots
    """
    now = datetime.now()
    search_end = now + timedelta(days=days_ahead)

    # Build list of busy times
    busy_times = []
    for event in events:
        start_str = event.get("start", {}).get("dateTime")
        end_str = event.get("end", {}).get("dateTime")

        if not start_str or not end_str:
            continue

        try:
            start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            end = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
            if start < search_end:
                busy_times.append((start, end))
        except (ValueError, AttributeError):
            continue

    # Sort by start time
    busy_times.sort(key=lambda x: x[0])

    # Find gaps
    free_slots = []
    current = now

    for day_offset in range(days_ahead):
        day = now.date() + timedelta(days=day_offset)
        day_start = datetime.combine(day, datetime.min.time()).replace(hour=work_hours[0])
        day_end = datetime.combine(day, datetime.min.time()).replace(hour=work_hours[1])

        # Skip if in the past
        if day_end < now:
            continue

        # Adjust current for new day
        current = max(now, day_start)

        # Check gaps between busy times on this day
        for busy_start, busy_end in busy_times:
            if busy_start.date() != day:
                continue

            # Gap before this busy time
            if (busy_start - current).total_seconds() >= duration_minutes * 60:
                free_slots.append((current, busy_start))

            current = max(current, busy_end)

        # Gap at end of day
        if (day_end - current).total_seconds() >= duration_minutes * 60:
            free_slots.append((current, day_end))

    return free_slots
