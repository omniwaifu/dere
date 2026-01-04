import { describe, expect, it } from "bun:test";

import {
  addLineNumbers,
  escapeAttr,
  indentLines,
  renderTag,
  renderTextTag,
  wrapCdata,
} from "./xml-utils.js";

describe("xml-utils", () => {
  it("escapeAttr escapes XML attribute characters", () => {
    expect(escapeAttr(`5" < 6 & 7 > 4`)).toBe("5&quot; &lt; 6 &amp; 7 &gt; 4");
  });

  it("wrapCdata escapes closing tokens", () => {
    expect(wrapCdata("hi ]]> there")).toBe("<![CDATA[hi ]]]]><![CDATA[> there]]>");
  });

  it("indentLines adds prefixes", () => {
    const indented = indentLines("a\n\nb", 2);
    expect(indented).toBe("  a\n  \n  b");
  });

  it("renderTag builds tags with attrs", () => {
    const inner = "  hello";
    const rendered = renderTag("note", inner, { indent: 2, attrs: { name: "x&y" } });
    expect(rendered).toBe('  <note name="x&amp;y">\n  hello\n  </note>');
  });

  it("renderTextTag wraps CDATA with indentation", () => {
    const rendered = renderTextTag("msg", "hi", { indent: 2 });
    expect(rendered).toBe("  <msg>\n    <![CDATA[hi]]>\n  </msg>");
  });

  it("addLineNumbers prefixes lines", () => {
    const numbered = addLineNumbers("a\nb", 1);
    expect(numbered).toBe("  1 | a\n  2 | b");
  });
});
