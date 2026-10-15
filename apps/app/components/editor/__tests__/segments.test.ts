import type { Segment } from "@/lib/types/pages";
import {
  applyPlainTextChange,
  applyTextEdit,
  diffText,
  segmentsToPlainText,
} from "../segments";

// "Hello **bold** world" with a link on "world".
const rich: Segment[] = [
  { text: "Hello " },
  { text: "bold", bold: true },
  { text: " " },
  { text: "world", link: "https://oxy.so" },
];

describe("diffText", () => {
  it("returns null for equal strings", () => {
    expect(diffText("abc", "abc")).toBeNull();
  });

  it("finds an insertion", () => {
    expect(diffText("Hello world", "Hello big world")).toEqual({
      index: 6,
      deleteCount: 0,
      insert: "big ",
    });
  });

  it("finds a deletion", () => {
    expect(diffText("Hello world", "Hello")).toEqual({
      index: 5,
      deleteCount: 6,
      insert: "",
    });
  });

  it("finds a replacement, as autocorrect or a paste over a selection produces", () => {
    expect(diffText("teh cat", "the cat")).toEqual({
      index: 1,
      deleteCount: 2,
      insert: "he",
    });
  });

  it("keeps prefix and suffix from overlapping on repeated characters", () => {
    expect(diffText("aaa", "aaaa")).toEqual({ index: 3, deleteCount: 0, insert: "a" });
    expect(diffText("aaaa", "aa")).toEqual({ index: 2, deleteCount: 2, insert: "" });
  });

  it("never splits a surrogate pair", () => {
    // 😀 and 😃 share their high surrogate.
    const edit = diffText("a😀b", "a😃b");
    expect(edit).toEqual({ index: 1, deleteCount: 2, insert: "😃" });
  });
});

describe("applyTextEdit", () => {
  it("keeps marks outside the edit", () => {
    const next = applyTextEdit(rich, { index: 0, deleteCount: 5, insert: "Hi" });
    expect(next).toEqual([
      { text: "Hi " },
      { text: "bold", bold: true },
      { text: " " },
      { text: "world", link: "https://oxy.so" },
    ]);
  });

  it("gives typed text the marks of its left neighbor", () => {
    const next = applyTextEdit(rich, { index: 10, deleteCount: 0, insert: "er" });
    expect(next[1]).toEqual({ text: "bolder", bold: true });
  });

  it("gives text typed over a selection the marks of the text it replaces", () => {
    // Replace "world" (the link) with "there".
    const next = applyTextEdit(rich, { index: 11, deleteCount: 5, insert: "there" });
    expect(next[next.length - 1]).toEqual({ text: "there", link: "https://oxy.so" });
  });

  it("takes the right neighbor's marks at offset 0", () => {
    const next = applyTextEdit([{ text: "bold", bold: true }], {
      index: 0,
      deleteCount: 0,
      insert: "very ",
    });
    expect(next).toEqual([{ text: "very bold", bold: true }]);
  });

  it("empties to no segments when everything is deleted", () => {
    expect(applyTextEdit(rich, { index: 0, deleteCount: 16, insert: "" })).toEqual([]);
  });
});

describe("applyPlainTextChange", () => {
  it("preserves formatting across a mobile edit (regression: it collapsed to one plain segment)", () => {
    const next = applyPlainTextChange(rich, "Hello bold world!");
    expect(segmentsToPlainText(next)).toBe("Hello bold world!");
    expect(next).toEqual([
      { text: "Hello " },
      { text: "bold", bold: true },
      { text: " " },
      { text: "world!", link: "https://oxy.so" },
    ]);
  });

  it("returns the same array when nothing changed", () => {
    expect(applyPlainTextChange(rich, "Hello bold world")).toBe(rich);
  });

  it("creates a plain segment from empty", () => {
    expect(applyPlainTextChange([], "a")).toEqual([{ text: "a" }]);
  });
});
