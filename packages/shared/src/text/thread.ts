import { X_DEFAULT_CHAR_LIMIT } from '../providers';
import { xWeightedLength } from './x-text';

/** A unit of text plus the separator that followed it in the original; `null` means a forced break. */
interface Piece {
  text: string;
  sep: string | null;
}

/** Per-call state: the limit and a memoized weighted-length function. */
interface SplitContext {
  limit: number;
  measure: (text: string) => number;
}

// Boundary levels, from coarsest to finest. Each regex matches the separator between two units.
const PARAGRAPH_SEP = /\n[^\S\n]*\n\s*/gu;
// After terminal punctuation (optionally followed by closing quotes/brackets) and whitespace,
// or right after a CJK full stop, which is usually not followed by a space.
const SENTENCE_SEP = /(?<=[.!?…]["'”’)\]]*)\s+|(?<=[。！？])\s*/gu;
const WORD_SEP = /\s+/gu;
const LEVELS = [PARAGRAPH_SEP, SENTENCE_SEP, WORD_SEP] as const;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Splits `text` into X thread items whose weighted length is at most `limit`.
 * Breaks on paragraph boundaries first, then sentences, then words, and hard-splits a single
 * word that is longer than the limit. Original whitespace inside an item is preserved; items are
 * trimmed and never empty. Returns `[]` for blank text.
 */
export function splitIntoThread(text: string, limit: number = X_DEFAULT_CHAR_LIMIT): string[] {
  // A CJK character or emoji weighs 2, so a smaller limit could never make progress.
  if (!Number.isInteger(limit) || limit < 2) {
    throw new RangeError(`limit must be an integer >= 2, got ${limit}`);
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const cache = new Map<string, number>();
  const measure = (s: string): number => {
    let weight = cache.get(s);
    if (weight === undefined) {
      weight = xWeightedLength(s);
      cache.set(s, weight);
    }
    return weight;
  };
  const ctx: SplitContext = { limit, measure };

  const chunks = splitToFit(trimmed, 0, ctx)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  // Safety net: packing uses an additive estimate across whitespace; re-check every item exactly.
  return chunks.flatMap((chunk) => (measure(chunk) <= limit ? [chunk] : hardSplit(chunk, ctx)));
}

function splitToFit(text: string, level: number, ctx: SplitContext): string[] {
  if (ctx.measure(text) <= ctx.limit) return [text];
  const sepRegex = LEVELS[level];
  if (sepRegex === undefined) return hardSplit(text, ctx);

  const pieces = splitKeepingSeparators(text, sepRegex);
  if (pieces.length <= 1) return splitToFit(text, level + 1, ctx);

  const expanded: Piece[] = [];
  for (const piece of pieces) {
    if (ctx.measure(piece.text) <= ctx.limit) {
      expanded.push(piece);
      continue;
    }
    const sub = splitToFit(piece.text, level + 1, ctx);
    sub.forEach((chunk, i) => {
      expanded.push({ text: chunk, sep: i === sub.length - 1 ? piece.sep : null });
    });
  }
  return pack(expanded, ctx);
}

/** Splits on `sepRegex`, trimming units and remembering the separator after each one. */
function splitKeepingSeparators(text: string, sepRegex: RegExp): Piece[] {
  const pieces: Piece[] = [];
  let start = 0;
  for (const match of text.matchAll(sepRegex)) {
    const end = match.index;
    if (end === start && match[0].length === 0) continue;
    pieces.push({ text: text.slice(start, end), sep: match[0] });
    start = end + match[0].length;
  }
  pieces.push({ text: text.slice(start), sep: null });
  return pieces
    .map((piece) => ({ text: piece.text.trim(), sep: piece.sep }))
    .filter((piece) => piece.text.length > 0);
}

/** Greedily joins consecutive pieces with their original separators while they fit. */
function pack(pieces: Piece[], { limit, measure }: SplitContext): string[] {
  const out: string[] = [];
  let current = '';
  let currentWeight = 0;
  let sep: string | null = null;

  for (const piece of pieces) {
    const pieceWeight = measure(piece.text);
    if (current.length === 0) {
      current = piece.text;
      currentWeight = pieceWeight;
    } else if (sep !== null) {
      // URLs and emoji never span whitespace, so weights are additive across a whitespace
      // separator. An empty separator (CJK full stop) gets an exact measurement instead.
      const candidateWeight =
        sep.length > 0
          ? currentWeight + measure(sep) + pieceWeight
          : measure(current + sep + piece.text);
      if (candidateWeight <= limit) {
        current = current + sep + piece.text;
        currentWeight = candidateWeight;
      } else {
        out.push(current);
        current = piece.text;
        currentWeight = pieceWeight;
      }
    } else {
      out.push(current);
      current = piece.text;
      currentWeight = pieceWeight;
    }
    sep = piece.sep;
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** Splits a single overlong word on grapheme boundaries (code points as a last resort). */
function hardSplit(text: string, { limit, measure }: SplitContext): string[] {
  const units: string[] = [];
  const weights: number[] = [];
  for (const { segment } of segmenter.segment(text)) {
    // A grapheme heavier than the limit (e.g. stacked combining marks) is split into code points,
    // each of which weighs at most 2.
    const parts = measure(segment) <= limit ? [segment] : Array.from(segment);
    for (const part of parts) {
      units.push(part);
      weights.push(measure(part));
    }
  }

  const out: string[] = [];
  let i = 0;
  while (i < units.length) {
    // Grow by the additive estimate, then back off until the exact weight fits
    // (a fragment can become a URL, which always weighs 23).
    let end = i;
    let estimate = 0;
    while (end < units.length && estimate + (weights[end] as number) <= limit) {
      estimate += weights[end] as number;
      end++;
    }
    if (end === i) end = i + 1;
    while (end - i > 1 && xWeightedLength(units.slice(i, end).join('')) > limit) end--;
    const chunk = units.slice(i, end).join('').trim();
    if (chunk.length > 0) out.push(chunk);
    i = end;
  }
  return out;
}
