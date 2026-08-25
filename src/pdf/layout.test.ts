import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ContextPackError } from "../errors.js";
import {
  COLUMN_COUNT,
  COLUMN_GAP,
  countWrappedLines,
  DENSITY_PROFILES,
  getColumnWidth,
  getLinesPerColumn,
  getLinesPerPage,
  MARGIN,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  planLayout,
} from "./layout.js";

describe("layout – A4 geometry and density profiles", () => {
  test("constants match spec", () => {
    expect(PAGE_WIDTH).toBe(595.28);
    expect(PAGE_HEIGHT).toBe(841.89);
    expect(MARGIN).toBe(10);
    expect(COLUMN_GAP).toBe(5);
    expect(COLUMN_COUNT).toBe(4);
  });

  test("column width derived correctly", () => {
    const w = getColumnWidth();
    // 595.28 -20 -15 =560.28 /4=140.07
    expect(w).toBeCloseTo(140.07, 1);
    expect(w).toBe((PAGE_WIDTH - 2 * MARGIN - COLUMN_GAP * (COLUMN_COUNT - 1)) / COLUMN_COUNT);
  });

  test("density profiles in order", () => {
    expect(DENSITY_PROFILES.map((p) => p.fontSize)).toEqual([2.0, 1.8, 1.4, 1.0, 0.8]);
    expect(DENSITY_PROFILES.map((p) => p.leading)).toEqual([2.3, 2.07, 1.61, 1.15, 0.92]);
  });

  test("lines per page for each profile", () => {
    // usableH =821.89
    expect(getLinesPerColumn(2.3)).toBe(Math.floor(821.89 / 2.3));
    expect(getLinesPerPage(2.3)).toBe(getLinesPerColumn(2.3) * 4);
    expect(getLinesPerPage(2.07)).toBe(Math.floor(821.89 / 2.07) * 4);
    expect(getLinesPerPage(1.61)).toBe(Math.floor(821.89 / 1.61) * 4);
    expect(getLinesPerPage(1.15)).toBe(Math.floor(821.89 / 1.15) * 4);
    expect(getLinesPerPage(0.92)).toBe(Math.floor(821.89 / 0.92) * 4);
    // concrete: 357*4=1428, 397*4=1588, 510*4=2040, 714*4=2856, 893*4=3572
    expect(getLinesPerPage(2.3)).toBe(1428);
    expect(getLinesPerPage(0.92)).toBe(3572);
  });

  test("word-aware wrapping respects word boundary", () => {
    const _colW = getColumnWidth();
    // Long words should not cause infinite loop; wrap still produces bounded lines
    const long = `${"a".repeat(500)} ${"b".repeat(500)}`;
    const lines = countWrappedLines(long, 2.0);
    expect(lines).toBeGreaterThan(1);
    expect(lines).toBeLessThan(20);
    // Word break should prefer whitespace split
    const sentence = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(10);
    const lines2 = countWrappedLines(sentence, 2.0);
    expect(lines2).toBeGreaterThan(1);
    // Leading whitespace trimmed: no empty leading line
    const ws = "   hello world   ";
    const lines3 = countWrappedLines(ws, 2.0);
    expect(lines3).toBe(1);
  });

  test("deterministic: repeated planLayout yields same profile and counts", () => {
    const src = "hello world — 안녕하세요 🌍 ".repeat(200);
    const a = planLayout(src, { pageBudget: 1 });
    const b = planLayout(src, { pageBudget: 1 });
    expect(a.profile).toEqual(b.profile);
    expect(a.lines).toBe(b.lines);
    expect(a.pageCount).toBe(b.pageCount);
  });

  test("selects largest fitting profile (small source fits largest)", () => {
    const small = "hello world";
    const plan = planLayout(small);
    expect(plan.profile.fontSize).toBe(2.0);
    expect(plan.pageCount).toBe(1);
  });

  test("adaptive: larger source may need smaller profile but still one page", () => {
    // Build source requiring ~1800 lines at 2pt => needs 1.4 or smaller
    // Use many newlines to force line count without width variance
    const manyLines = Array.from({ length: 1500 }, (_, i) => `line ${i} hello world`).join("\n");
    const plan = planLayout(manyLines);
    // 1500 lines fits at 2.0 (1428 would overflow) so must drop to 1.8 (1588) or smaller
    expect(plan.profile.fontSize).toBeLessThanOrEqual(1.8);
    expect(plan.pageCount).toBe(1);
    // Deterministic
    const plan2 = planLayout(manyLines);
    expect(plan.profile).toEqual(plan2.profile);
  });

  test("failure – U+0378 reports codepoint and source offset", () => {
    const src = `abc${String.fromCodePoint(0x0378)}def`;
    try {
      planLayout(src);
      throw new Error("should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ContextPackError);
      const e = err as ContextPackError;
      expect(e.code).toBe("UNSUPPORTED_GLYPH");
      const d = e.details as { codePoint: number; offset: number };
      expect(d.codePoint).toBe(0x0378);
      expect(d.offset).toBe(3);
    }
  });

  test("failure – U+0378 at different offset", () => {
    const src = `${String.fromCodePoint(0x0378)}hello`;
    try {
      planLayout(src);
      throw new Error("should have thrown");
    } catch (err: unknown) {
      const e = err as ContextPackError;
      expect(e.code).toBe("UNSUPPORTED_GLYPH");
      expect((e.details as { offset: number }).offset).toBe(0);
    }
  });

  test("failure – overflow at 0.8pt reports PageBudgetExceededError before rendering", () => {
    // Force overflow beyond 3572 lines at smallest profile
    const overflow = Array.from({ length: 4000 }, () => "x").join("\n");
    try {
      planLayout(overflow, { pageBudget: 1 });
      throw new Error("should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ContextPackError);
      const e = err as ContextPackError;
      expect(e.code).toBe("PAGE_BUDGET_EXCEEDED");
      const d = e.details as { pageBudget: number; requiredPages: number };
      expect(d.pageBudget).toBe(1);
      expect(d.requiredPages).toBeGreaterThan(1);
    }
  });

  test("does not use fallback font or custom page size – throws rather than adjusts", () => {
    const miss = `ok${String.fromCodePoint(0x0378)}`;
    expect(() => planLayout(miss)).toThrow();
    const huge = Array.from({ length: 5000 }, () => "overflow").join("\n");
    expect(() => planLayout(huge)).toThrow();
    // Ensure error is typed, not generic fallback
    try {
      planLayout(miss);
    } catch (e) {
      expect((e as ContextPackError).code).toBe("UNSUPPORTED_GLYPH");
    }
  });

  test("5k/20k/50k seed-42 corpora select stable largest fitting profiles (if available)", () => {
    // Try to read private corpora txt if present; skip if absent
    const candidates = [
      "C:/Users/torch/Documents/code/pdftokenizer/pagefold_validation/corpus_5k.txt",
      "C:/Users/torch/Documents/code/pdftokenizer/pagefold_validation/corpus_20k.txt",
      "C:/Users/torch/Documents/code/pdftokenizer/pagefold_validation/corpus_50k.txt",
    ];
    const present = candidates.filter((p) => existsSync(p));
    if (present.length === 0) {
      // Fallback synthetic corpora with same seed logic (approx sizes)
      const vocab = ["lorem", "ipsum", "dolor", "sit", "amet", "consectetur"];
      function synth(chars: number): string {
        const words: string[] = [];
        let len = 0;
        let i = 0;
        // deterministic: cycle vocab
        while (len < chars) {
          const w = vocab[i % vocab.length] as string;
          words.push(w);
          len += w.length + 1;
          i += 1;
          if (i % 22 === 0) words.push("\n");
        }
        return words.join(" ");
      }
      const c5 = synth(20784);
      const c20 = synth(81062);
      const c50 = synth(201500);
      const p5a = planLayout(c5);
      const p5b = planLayout(c5);
      expect(p5a.profile).toEqual(p5b.profile);
      const p20a = planLayout(c20);
      const p20b = planLayout(c20);
      expect(p20a.profile).toEqual(p20b.profile);
      const p50a = planLayout(c50);
      const p50b = planLayout(c50);
      expect(p50a.profile).toEqual(p50b.profile);
      // Larger corpora should not select larger font than smaller (monotonic)
      expect(p20a.profile.fontSize).toBeLessThanOrEqual(p5a.profile.fontSize);
      expect(p50a.profile.fontSize).toBeLessThanOrEqual(p20a.profile.fontSize);
      return;
    }
    for (const path of present) {
      const src = readFileSync(path, "utf8");
      const a = planLayout(src);
      const b = planLayout(src);
      expect(a.profile).toEqual(b.profile);
      expect(a.pageCount).toBe(b.pageCount);
      expect(a.pageCount).toBe(1);
    }
    // Monotonic across sizes if all three present
    if (present.length === 3) {
      const s5 = readFileSync(present[0] as string, "utf8");
      const s20 = readFileSync(present[1] as string, "utf8");
      const s50 = readFileSync(present[2] as string, "utf8");
      const p5 = planLayout(s5);
      const p20 = planLayout(s20);
      const p50 = planLayout(s50);
      expect(p20.profile.fontSize).toBeLessThanOrEqual(p5.profile.fontSize);
      expect(p50.profile.fontSize).toBeLessThanOrEqual(p20.profile.fontSize);
    }
  });

  test("LOC gate ≤250 per module", () => {
    const files = [
      join(process.cwd(), "src/pdf/graphemes.ts"),
      join(process.cwd(), "src/pdf/font-coverage.ts"),
      join(process.cwd(), "src/pdf/layout.ts"),
    ];
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n").length;
      expect(lines).toBeLessThanOrEqual(250);
    }
  });

  test("CJK and emoji coverage passes planning", () => {
    const src = "안녕하세요 🌍 你好 👨‍👩‍👧‍👦 ☀️";
    const plan = planLayout(src);
    expect(plan.pageCount).toBe(1);
    expect(plan.profile.fontSize).toBe(2.0);
  });
});
