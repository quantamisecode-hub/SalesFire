// RichEmailEditor.lightClean — client-side defense-in-depth before content
// enters the editable area (the server sanitizes again on every render, §45).
import { describe, it, expect } from "vitest";
import { lightClean } from "./RichEmailEditor";

describe("lightClean", () => {
  it("strips script blocks", () => {
    expect(lightClean("<p>hi</p><script>alert(1)</script>")).toBe("<p>hi</p>");
  });

  it("strips iframes (self-closing, paired and unterminated)", () => {
    expect(lightClean("<iframe src=\"evil\"></iframe>ok")).toBe("ok");
    expect(lightClean("<iframe src=\"evil\"/>ok")).toBe("ok");
    // An unterminated opener makes everything after it part of the tag (per
    // HTML tokenization), so it is dropped along with the tag.
    expect(lightClean("<iframe src=\"evil\"ok")).toBe("");
  });

  it("strips inline event handlers", () => {
    expect(lightClean('<p onclick="alert(1)">x</p>')).toBe("<p>x</p>");
    expect(lightClean("<img onerror='alert(1)' src='x'>")).toBe("<img src='x'>");
  });

  it("strips javascript: URLs", () => {
    expect(lightClean('<a href="javascript:alert(1)">x</a>')).toBe('<a href="alert(1)">x</a>'.replace("alert", "alert"));
    // The scheme itself is gone; the server-side sanitizer drops the anchor.
    expect(lightClean('<a href="javascript:alert(1)">x</a>')).not.toContain("javascript:");
  });

  it("keeps normal content untouched", () => {
    expect(lightClean("<p><strong>Hi</strong> {{first_name}}</p>")).toBe("<p><strong>Hi</strong> {{first_name}}</p>");
  });

  it("treats null/undefined as empty", () => {
    expect(lightClean(null as unknown as string)).toBe("");
    expect(lightClean(undefined as unknown as string)).toBe("");
  });
});
