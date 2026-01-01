export type XmlAttributes = Record<string, string | number | boolean | null | undefined>;

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function wrapCdata(text: string): string {
  return `<![CDATA[${text.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

export function indentLines(text: string, indent: number): string {
  const prefix = " ".repeat(indent);
  return text
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : prefix))
    .join("\n");
}

export function renderTag(
  tag: string,
  inner: string,
  options: { indent?: number; attrs?: XmlAttributes } = {},
): string {
  if (!inner) {
    return "";
  }

  const { indent = 0, attrs } = options;
  let attrString = "";
  if (attrs) {
    const parts = Object.entries(attrs)
      .filter(([, value]) => value !== null && value !== undefined && String(value))
      .map(([key, value]) => `${key}="${escapeAttr(String(value))}"`);
    if (parts.length > 0) {
      attrString = ` ${parts.join(" ")}`;
    }
  }

  const indentStr = " ".repeat(indent);
  return `${indentStr}<${tag}${attrString}>\n${inner}\n${indentStr}</${tag}>`;
}

export function renderTextTag(
  tag: string,
  text: string,
  options: { indent?: number; attrs?: XmlAttributes } = {},
): string {
  const indent = options.indent ?? 0;
  const inner = indentLines(wrapCdata(text), indent + 2);
  return renderTag(tag, inner, options);
}

export function addLineNumbers(text: string, start = 1, separator = " | "): string {
  if (!text) {
    return text;
  }
  const lines = text.split("\n");
  const width = Math.max(3, String(start + lines.length - 1).length);
  return lines
    .map((line, index) => {
      const number = String(start + index).padStart(width, " ");
      return `${number}${separator}${line}`;
    })
    .join("\n");
}
