/**
 * Deterministic adaptive A4 layout planner — 4 columns, density profiles.
 * Selects largest profile fitting the pageBudget (default 1) without fallback.
 */
import { ContextPackError } from "../errors.js";
import { assertCoverage } from "./font-coverage.js";
import {
  isCjkGrapheme,
  isEmojiGrapheme,
  isFormatGrapheme,
  isWhitespaceGrapheme,
  segmentGraphemes,
} from "./graphemes.js";

export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;
export const MARGIN = 10;
export const COLUMN_GAP = 5;
export const COLUMN_COUNT = 4;

export interface DensityProfile {
  readonly fontSize: number;
  readonly leading: number;
}

export const DENSITY_PROFILES: readonly DensityProfile[] = [
  { fontSize: 2.0, leading: 2.3 },
  { fontSize: 1.8, leading: 2.07 },
  { fontSize: 1.4, leading: 1.61 },
  { fontSize: 1.0, leading: 1.15 },
  { fontSize: 0.8, leading: 0.92 },
] as const;

export interface LayoutPlan {
  readonly profile: DensityProfile;
  readonly lines: number;
  readonly linesPerPage: number;
  readonly pageCount: number;
  readonly columnWidth: number;
}

export function getColumnWidth(): number {
  const usable = PAGE_WIDTH - 2 * MARGIN - COLUMN_GAP * (COLUMN_COUNT - 1);
  return usable / COLUMN_COUNT;
}

export function getLinesPerColumn(leading: number): number {
  const usableH = PAGE_HEIGHT - 2 * MARGIN;
  return Math.max(1, Math.floor(usableH / leading));
}

export function getLinesPerPage(leading: number): number {
  return getLinesPerColumn(leading) * COLUMN_COUNT;
}

function estimateWidth(grapheme: string, fontSize: number): number {
  if (grapheme === "\n" || grapheme === "\r") return 0;
  if (isFormatGrapheme(grapheme)) return 0;
  if (isCjkGrapheme(grapheme) || isEmojiGrapheme(grapheme)) return fontSize;
  if (isWhitespaceGrapheme(grapheme)) return fontSize * 0.5;
  return fontSize * 0.5;
}

interface WrapToken {
  readonly text: string;
  readonly width: number;
  readonly whitespace: boolean;
  readonly newline: boolean;
}

function buildTokens(source: string, fontSize: number): readonly WrapToken[] {
  const graphemes = segmentGraphemes(source);
  const out: WrapToken[] = [];
  for (const g of graphemes) {
    if (g === "\n") {
      out.push({ text: g, width: 0, whitespace: false, newline: true });
      continue;
    }
    if (g === "\r") {
      out.push({ text: "\n", width: 0, whitespace: false, newline: true });
      continue;
    }
    out.push({
      text: g,
      width: estimateWidth(g, fontSize),
      whitespace: isWhitespaceGrapheme(g),
      newline: false,
    });
  }
  return out;
}

function trimLineEnd(tokens: readonly WrapToken[]): readonly WrapToken[] {
  let end = tokens.length;
  while (end > 0 && tokens[end - 1]?.whitespace) end -= 1;
  return tokens.slice(0, end);
}

function trimLineStart(tokens: readonly WrapToken[]): readonly WrapToken[] {
  let start = 0;
  while (start < tokens.length && tokens[start]?.whitespace) start += 1;
  return tokens.slice(start);
}

function pushLine(lines: WrapToken[][], tokens: readonly WrapToken[]): void {
  const trimmed = trimLineEnd(tokens);
  if (trimmed.length > 0) lines.push([...trimmed]);
}

function wrapTokens(tokens: readonly WrapToken[], columnWidth: number): WrapToken[][] {
  const lines: WrapToken[][] = [];
  let current: WrapToken[] = [];
  let currentWidth = 0;
  for (const token of tokens) {
    if (token.newline) {
      pushLine(lines, current);
      current = [];
      currentWidth = 0;
      continue;
    }
    if (current.length > 0 && currentWidth + token.width > columnWidth) {
      let breakAt = -1;
      const earliest = Math.floor(current.length * 0.55);
      for (let i = current.length - 1; i > earliest; i -= 1) {
        if (current[i]?.whitespace) {
          breakAt = i;
          break;
        }
      }
      if (breakAt >= 0) {
        pushLine(lines, current.slice(0, breakAt));
        current = [...trimLineStart(current.slice(breakAt + 1))];
        currentWidth = current.reduce((s, t) => s + t.width, 0);
      } else {
        pushLine(lines, current);
        current = [];
        currentWidth = 0;
      }
    }
    if (current.length === 0 && token.whitespace) continue;
    current.push(token);
    currentWidth += token.width;
  }
  pushLine(lines, current);
  if (lines.length === 0) {
    // Ensure at least one line for empty-trim edge (caller ensures non-empty source)
    lines.push([]);
  }
  return lines;
}

export function countWrappedLines(source: string, fontSize: number): number {
  const colW = getColumnWidth();
  const tokens = buildTokens(source, fontSize);
  return wrapTokens(tokens, colW).length;
}

export function planLayout(source: string, options?: { readonly pageBudget?: number }): LayoutPlan {
  if (typeof source !== "string") {
    throw new ContextPackError(
      { code: "INVALID_CONTEXT", details: { reason: "source must be string" } },
      "Invalid context: source must be string"
    );
  }
  assertCoverage(source);
  const pageBudget = options?.pageBudget ?? 1;
  if (!Number.isInteger(pageBudget) || pageBudget < 1) {
    throw new ContextPackError(
      { code: "PAGE_BUDGET_EXCEEDED", details: { pageBudget, requiredPages: 1 } },
      `Page budget exceeded: budget=${pageBudget}`
    );
  }
  const columnWidth = getColumnWidth();
  let lastLines = 0;
  let lastPerPage = 1;
  for (const profile of DENSITY_PROFILES) {
    const lines = countWrappedLines(source, profile.fontSize);
    const perPage = getLinesPerPage(profile.leading);
    const pages = Math.max(1, Math.ceil(lines / perPage));
    lastLines = lines;
    lastPerPage = perPage;
    if (pages <= pageBudget) {
      return { profile, lines, linesPerPage: perPage, pageCount: pages, columnWidth };
    }
  }
  const smallest = DENSITY_PROFILES[DENSITY_PROFILES.length - 1];
  if (!smallest) throw new Error("no profiles");
  const requiredPages = Math.max(1, Math.ceil(lastLines / lastPerPage));
  throw new ContextPackError(
    { code: "PAGE_BUDGET_EXCEEDED", details: { pageBudget, requiredPages } },
    `Page budget exceeded: need ${requiredPages} pages at ${smallest.fontSize}pt`
  );
}
