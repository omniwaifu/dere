"""Natural language schedule parser using Haiku mini-agent."""

from __future__ import annotations

from croniter import croniter
from loguru import logger
from pydantic import BaseModel


class ScheduleParseResult(BaseModel):
    cron: str
    timezone: str = "UTC"
    explanation: str | None = None


async def parse_natural_language_schedule(nl_schedule: str) -> tuple[str, str]:
    """Parse natural language schedule into cron expression.

    Uses Haiku to convert natural language like "every day at 6pm" into
    a standard 5-field cron expression.

    Args:
        nl_schedule: Natural language schedule description

    Returns:
        (cron_expression, timezone) tuple

    Raises:
        ValueError: If schedule cannot be parsed or is invalid
    """
    from dere_graph.llm_client import ClaudeClient, Message

    client = ClaudeClient(model="claude-haiku-4-5")

    prompt = f"""Convert this natural language schedule to a cron expression.

Natural language: {nl_schedule}

Return structured output with:
- cron: standard 5-field cron expression (minute hour day month weekday)
- timezone: IANA timezone like America/New_York or UTC
- explanation: brief explanation of when this runs

Examples:
- "every day at 6pm" → {{"cron": "0 18 * * *", "timezone": "UTC", "explanation": "Daily at 6:00 PM UTC"}}
- "every Monday at 9am EST" → {{"cron": "0 9 * * 1", "timezone": "America/New_York", "explanation": "Every Monday at 9:00 AM EST"}}
- "every 2 hours" → {{"cron": "0 */2 * * *", "timezone": "UTC", "explanation": "Every 2 hours at the top of the hour"}}
- "weekdays at 8:30am" → {{"cron": "30 8 * * 1-5", "timezone": "UTC", "explanation": "Monday through Friday at 8:30 AM"}}
- "first of every month at noon" → {{"cron": "0 12 1 * *", "timezone": "UTC", "explanation": "1st of each month at 12:00 PM"}}
"""

    try:
        result = await client.generate_response(
            [Message(role="user", content=prompt)],
            ScheduleParseResult,
        )
        cron_expr = result.cron
        timezone = result.timezone or "UTC"

        # Validate cron expression
        _validate_cron(cron_expr)

        logger.info(
            "Parsed schedule '{}' -> cron='{}' tz='{}' ({})",
            nl_schedule,
            cron_expr,
            timezone,
            result.explanation or "",
        )

        return cron_expr, timezone

    except ValueError:
        raise
    except Exception as e:
        logger.exception("Unexpected error parsing schedule")
        raise ValueError(f"Failed to parse schedule '{nl_schedule}': {e}") from e


def _validate_cron(cron_expr: str) -> None:
    """Validate a cron expression.

    Raises:
        ValueError: If cron expression is invalid
    """
    parts = cron_expr.split()
    if len(parts) != 5:
        raise ValueError(
            f"Invalid cron format: '{cron_expr}' (expected 5 fields: minute hour day month weekday)"
        )

    try:
        # croniter will raise if invalid
        croniter(cron_expr)
    except (KeyError, ValueError) as e:
        raise ValueError(f"Invalid cron expression '{cron_expr}': {e}") from e


def is_valid_cron(cron_expr: str) -> bool:
    """Check if a string is a valid cron expression.

    Args:
        cron_expr: String to validate

    Returns:
        True if valid cron expression, False otherwise
    """
    try:
        _validate_cron(cron_expr)
        return True
    except ValueError:
        return False
