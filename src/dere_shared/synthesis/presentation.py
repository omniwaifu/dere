"""LLM-based presentation layer for synthesis insights.

Takes statistical insights and formats them according to personality context,
allowing the LLM to interpret and present insights naturally.
"""

from __future__ import annotations

from typing import Any


async def format_insights_with_personality(
    insights: list[dict[str, Any]],
    personality_config: dict[str, Any],
    ollama_client: Any,
    model: str = "gemma3n:latest",
) -> str:
    """Format statistical insights according to personality context.

    Args:
        insights: List of statistical insight dicts
        personality_config: Personality configuration with occ_goals, occ_standards, occ_attitudes
        ollama_client: Ollama client for LLM generation
        model: Model to use for formatting

    Returns:
        Natural language formatted insights
    """
    if not insights:
        return "No insights generated yet."

    # Build personality context summary
    personality_context = _build_personality_context(personality_config)

    # Build insights summary
    insights_summary = _build_insights_summary(insights)

    # Create LLM prompt
    prompt = f"""You are presenting synthesis insights to a user. Format the following statistical insights in a natural, conversational way that matches the personality context.

Personality Context:
{personality_context}

Statistical Insights:
{insights_summary}

Present these insights in a way that:
1. Matches the personality's communication style based on their goals, standards, and attitudes
2. Highlights the most important patterns first
3. Uses natural language rather than technical statistical terms
4. Is concise but informative (2-3 paragraphs maximum)

Do not invent new insights - only present what's provided in the statistical data."""

    try:
        response = await ollama_client.generate(prompt, model=model)
        return response.strip()
    except Exception:
        # Fallback to basic formatting if LLM fails
        return _format_insights_fallback(insights)


def _build_personality_context(personality_config: dict[str, Any]) -> str:
    """Build personality context string from config.

    Args:
        personality_config: Personality dict with name, occ_goals, occ_standards, occ_attitudes

    Returns:
        Formatted personality context string
    """
    parts = []

    # Add personality name
    name = personality_config.get("name", "Unknown")
    parts.append(f"Personality: {name}")

    # Add goals
    goals = personality_config.get("occ_goals", [])
    if goals:
        goal_desc = ", ".join([g.get("description", "") for g in goals[:3]])
        parts.append(f"Goals: {goal_desc}")

    # Add standards
    standards = personality_config.get("occ_standards", [])
    if standards:
        standard_desc = ", ".join([s.get("description", "") for s in standards[:3]])
        parts.append(f"Standards: {standard_desc}")

    # Add attitudes
    attitudes = personality_config.get("occ_attitudes", [])
    if attitudes:
        attitude_desc = ", ".join(
            [
                f"{a.get('description', '')} toward {a.get('target_object', '')}"
                for a in attitudes[:2]
            ]
        )
        parts.append(f"Attitudes: {attitude_desc}")

    return "\n".join(parts)


def _build_insights_summary(insights: list[dict[str, Any]]) -> str:
    """Build summary of statistical insights.

    Args:
        insights: List of insight dicts

    Returns:
        Formatted insights summary string
    """
    lines = []

    for i, insight in enumerate(insights, 1):
        insight_type = insight.get("type", "unknown")
        description = insight.get("description", "")
        evidence = insight.get("statistical_evidence", {})

        line = f"{i}. [{insight_type}] {description}"

        # Add key evidence details
        if evidence:
            evidence_parts = []
            for key, value in evidence.items():
                if isinstance(value, int | float):
                    evidence_parts.append(f"{key}={value}")
                elif isinstance(value, dict) and len(value) <= 3:
                    evidence_parts.append(f"{key}={value}")

            if evidence_parts:
                line += f" (Evidence: {', '.join(evidence_parts[:3])})"

        lines.append(line)

    return "\n".join(lines)


def _format_insights_fallback(insights: list[dict[str, Any]]) -> str:
    """Fallback formatting if LLM is unavailable.

    Args:
        insights: List of insight dicts

    Returns:
        Basic formatted insights string
    """
    if not insights:
        return "No insights available."

    lines = ["Conversation Insights:", ""]

    for insight in insights[:5]:  # Top 5
        insight_type = insight.get("type", "unknown").replace("_", " ").title()
        description = insight.get("description", "No description")
        lines.append(f"• [{insight_type}] {description}")

    return "\n".join(lines)


async def format_patterns_with_personality(
    patterns: list[dict[str, Any]],
    personality_config: dict[str, Any],
    ollama_client: Any,
    model: str = "gemma3n:latest",
) -> str:
    """Format detected patterns according to personality context.

    Args:
        patterns: List of pattern dicts
        personality_config: Personality configuration
        ollama_client: Ollama client for LLM generation
        model: Model to use for formatting

    Returns:
        Natural language formatted patterns
    """
    if not patterns:
        return "No patterns detected yet."

    # Build personality context
    personality_context = _build_personality_context(personality_config)

    # Build patterns summary
    patterns_summary = _build_patterns_summary(patterns)

    # Create LLM prompt
    prompt = f"""You are presenting conversation patterns to a user. Format the following detected patterns in a natural, conversational way that matches the personality context.

Personality Context:
{personality_context}

Detected Patterns:
{patterns_summary}

Present these patterns in a way that:
1. Matches the personality's communication style
2. Groups similar patterns together
3. Uses natural language
4. Is concise but informative (2-3 paragraphs maximum)

Do not invent new patterns - only present what's provided."""

    try:
        response = await ollama_client.generate(prompt, model=model)
        return response.strip()
    except Exception:
        # Fallback to basic formatting
        return _format_patterns_fallback(patterns)


def _build_patterns_summary(patterns: list[dict[str, Any]]) -> str:
    """Build summary of detected patterns.

    Args:
        patterns: List of pattern dicts

    Returns:
        Formatted patterns summary string
    """
    lines = []

    for i, pattern in enumerate(patterns, 1):
        pattern_type = pattern.get("pattern_type", "unknown")
        description = pattern.get("description", "")
        frequency = pattern.get("frequency", 0)

        line = f"{i}. [{pattern_type}] {description} (frequency: {frequency})"
        lines.append(line)

    return "\n".join(lines)


def _format_patterns_fallback(patterns: list[dict[str, Any]]) -> str:
    """Fallback formatting if LLM is unavailable.

    Args:
        patterns: List of pattern dicts

    Returns:
        Basic formatted patterns string
    """
    if not patterns:
        return "No patterns available."

    lines = ["Detected Patterns:", ""]

    for pattern in patterns[:5]:  # Top 5
        pattern_type = pattern.get("pattern_type", "unknown").replace("_", " ").title()
        description = pattern.get("description", "No description")
        frequency = pattern.get("frequency", 0)
        lines.append(f"• [{pattern_type}] {description} (appears {frequency}x)")

    return "\n".join(lines)
