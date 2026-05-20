import { describe, it, expect } from "vitest";
import { isClean, reasonForRejection } from "./profanity";

describe("isClean", () => {
  it("accepts a plain clean nickname", () => {
    expect(isClean("alice")).toBe(true);
  });

  it("accepts a name that does not substring-match any bad word", () => {
    expect(isClean("Bob")).toBe(true);
    expect(isClean("Charlie123")).toBe(true);
  });

  it("accepts the empty string (substring match against empty input never hits)", () => {
    // baseline behavior — joinPlayer guards empty separately
    expect(isClean("")).toBe(true);
  });

  it("rejects an obvious bad word", () => {
    expect(isClean("fuckface")).toBe(false);
    expect(isClean("shithead")).toBe(false);
    expect(isClean("asshole")).toBe(false);
  });

  it("rejects bad words inside a longer string (substring match)", () => {
    expect(isClean("xxfuckxx")).toBe(false);
  });

  it("rejects leet substitutions via digit-letter map", () => {
    // 4 -> a, $ -> s, 0 -> o, 7 -> t
    expect(isClean("sh!t")).toBe(true); // ! is dropped, becomes "sht"
    expect(isClean("$h1t")).toBe(false); // $->s, 1->i, becomes "shit"
    expect(isClean("f4g")).toBe(false); // 4->a, becomes "fag"
  });

  it("rejects when the '1 as l' alternate normalization matches", () => {
    // "fag" exists in BAD_WORDS; verify both 1-modes are tried
    // "sl1t" with 1->l is "sllt" (no match), with 1->i is "slit" (no match)
    // "s1ut" with 1->l is "slut" → bad
    expect(isClean("s1ut")).toBe(false);
  });

  it("strips characters outside a-z when normalizing", () => {
    // unicode/punctuation should be dropped, not treated as wildcards
    expect(isClean("a!l@ic#e")).toBe(true);
  });

  it("Scunthorpe-style false positive is current behavior (codex F11 baseline)", () => {
    // 'cunt' is in BAD_WORDS and substring-matches "Scunthorpe"
    expect(isClean("Scunthorpe")).toBe(false);
  });
});

describe("reasonForRejection", () => {
  it("returns null for clean nicknames", () => {
    expect(reasonForRejection("alice")).toBeNull();
  });

  it("returns the rejection message for unclean nicknames", () => {
    expect(reasonForRejection("fuckface")).toBe("Pick another nickname");
  });
});
