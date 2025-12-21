"""Minimal XML rendering helpers for prompt context."""

from __future__ import annotations

from typing import Mapping


def _escape_attr(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("\"", "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def wrap_cdata(text: str) -> str:
    return "<![CDATA[" + text.replace("]]>", "]]]]><![CDATA[>") + "]]>"


def indent_lines(text: str, indent: int) -> str:
    prefix = " " * indent
    return "\n".join(f"{prefix}{line}" if line else prefix for line in text.splitlines())


def render_tag(
    tag: str,
    inner: str,
    *,
    indent: int = 0,
    attrs: Mapping[str, str] | None = None,
) -> str:
    if not inner:
        return ""

    attr_str = ""
    if attrs:
        parts = []
        for key, value in attrs.items():
            if value is None:
                continue
            value_str = str(value)
            if not value_str:
                continue
            parts.append(f'{key}="{_escape_attr(value_str)}"')
        if parts:
            attr_str = " " + " ".join(parts)

    indent_str = " " * indent
    return f"{indent_str}<{tag}{attr_str}>\n{inner}\n{indent_str}</{tag}>"


def render_text_tag(
    tag: str,
    text: str,
    *,
    indent: int = 0,
    attrs: Mapping[str, str] | None = None,
) -> str:
    cdata = wrap_cdata(text)
    inner = indent_lines(cdata, indent + 2)
    return render_tag(tag, inner, indent=indent, attrs=attrs)


def add_line_numbers(text: str, *, start: int = 1, separator: str = " | ") -> str:
    if not text:
        return text
    lines = text.splitlines()
    width = max(3, len(str(start + len(lines) - 1)))
    numbered = [
        f"{index:{width}d}{separator}{line}"
        for index, line in enumerate(lines, start=start)
    ]
    return "\n".join(numbered)
