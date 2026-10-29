import { describe, expect, it } from 'vitest';
import { splitIntoThread, xWeightedLength } from '../src';

const stripSpace = (s: string) => s.replace(/\s+/g, '');

function expectValidThread(items: string[], source: string, limit: number) {
  for (const item of items) {
    expect(item.length).toBeGreaterThan(0);
    expect(item).toBe(item.trim());
    expect(xWeightedLength(item)).toBeLessThanOrEqual(limit);
  }
  // No content is lost or reordered; only whitespace at item boundaries goes away.
  expect(stripSpace(items.join(''))).toBe(stripSpace(source));
}

describe('splitIntoThread', () => {
  it('returns [] for blank text', () => {
    expect(splitIntoThread('')).toEqual([]);
    expect(splitIntoThread('   \n\n  ')).toEqual([]);
  });

  it('keeps text that fits as a single trimmed item', () => {
    expect(splitIntoThread('  hello world  ')).toEqual(['hello world']);
  });

  it('keeps exactly-limit text in one item and splits one character over', () => {
    const exact = `${'a'.repeat(139)} ${'b'.repeat(140)}`;
    expect(xWeightedLength(exact)).toBe(280);
    expect(splitIntoThread(exact)).toEqual([exact]);

    const over = `${'a'.repeat(140)} ${'b'.repeat(140)}`;
    expect(splitIntoThread(over)).toEqual(['a'.repeat(140), 'b'.repeat(140)]);
  });

  it('breaks on paragraphs first', () => {
    const p1 = 'First paragraph. '.repeat(10).trim();
    const p2 = 'Second paragraph. '.repeat(10).trim();
    const text = `${p1}\n\n${p2}`;
    expect(splitIntoThread(text)).toEqual([p1, p2]);
  });

  it('packs several short paragraphs into one item, preserving blank lines', () => {
    const text = `${'a'.repeat(100)}\n\n${'b'.repeat(100)}\n\n${'c'.repeat(100)}`;
    expect(splitIntoThread(text)).toEqual([
      `${'a'.repeat(100)}\n\n${'b'.repeat(100)}`,
      'c'.repeat(100),
    ]);
  });

  it('breaks on sentences when a paragraph is too long', () => {
    const sentence = 'This sentence is exactly fifty characters long ok.';
    expect(sentence.length).toBe(50);
    const text = Array.from({ length: 8 }, () => sentence).join(' ');
    const items = splitIntoThread(text);
    expect(items).toHaveLength(2);
    for (const item of items) expect(item.endsWith('.')).toBe(true);
    expectValidThread(items, text, 280);
  });

  it('breaks on words when a sentence is too long, without cutting words', () => {
    const words = Array.from({ length: 120 }, (_, i) => `word${i}`);
    const text = words.join(' ');
    const items = splitIntoThread(text);
    expect(items.length).toBeGreaterThan(1);
    expect(items.flatMap((item) => item.split(' '))).toEqual(words);
    expectValidThread(items, text, 280);
  });

  it('hard-splits a single overlong word', () => {
    expect(splitIntoThread('a'.repeat(600)).map((s) => s.length)).toEqual([280, 280, 40]);
  });

  it('hard-splits CJK and emoji on grapheme boundaries', () => {
    const cjk = '你'.repeat(300);
    const items = splitIntoThread(cjk);
    expect(items.map((s) => xWeightedLength(s))).toEqual([280, 280, 40]);

    const family = '👨‍👩‍👧‍👦';
    const emoji = family.repeat(200);
    const emojiItems = splitIntoThread(emoji);
    expectValidThread(emojiItems, emoji, 280);
    for (const item of emojiItems)
      expect(item.split(family).every((rest) => rest === '')).toBe(true);
  });

  it('splits CJK prose after full stops even without spaces', () => {
    const sentence = '今日はとても良い天気です。';
    const text = sentence.repeat(30);
    const items = splitIntoThread(text);
    expect(items.length).toBeGreaterThan(1);
    for (const item of items) expect(item.endsWith('。')).toBe(true);
    expectValidThread(items, text, 280);
  });

  it('keeps URLs intact and counts them as 23', () => {
    const url = `https://example.com/${'x'.repeat(100)}`;
    const text = Array.from({ length: 20 }, (_, i) => `link ${i} ${url}`).join(' ');
    const items = splitIntoThread(text);
    expectValidThread(items, text, 280);
    for (const item of items) {
      for (const token of item.split(/\s+/)) {
        if (token.startsWith('https://')) expect(token).toBe(url);
      }
    }
  });

  it('respects a custom limit, including long posts', () => {
    const text = 'lorem ipsum dolor sit amet '.repeat(2_000).trim();
    expectValidThread(splitIntoThread(text, 50), text, 50);
    const long = splitIntoThread(text, 25_000);
    expect(long.length).toBe(3);
    expectValidThread(long, text, 25_000);
  });

  it('rejects limits that cannot make progress', () => {
    expect(() => splitIntoThread('abc', 1)).toThrow(RangeError);
    expect(() => splitIntoThread('abc', 2.5)).toThrow(RangeError);
  });
});

// Deterministic PRNG so failures are reproducible.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('splitIntoThread property: never empty, never over the limit, never loses content', () => {
  const tokens = [
    'a',
    'word',
    'Hello',
    'supercalifragilisticexpialidocious',
    'x'.repeat(90),
    'y'.repeat(400),
    '你好',
    '今日は良い天気です',
    '😀',
    '👨‍👩‍👧‍👦',
    '🇦🇷',
    'café',
    'https://example.com/some/path',
    'example.com',
    `https://example.org/${'z'.repeat(300)}`,
    '@someone',
    '#hashtag',
    '.',
    '!',
    '?',
    '…',
    '。',
    '"quoted."',
  ];
  const separators = [' ', ' ', ' ', ' ', '  ', '\n', '\n\n', '\n \n', '\t', ''];
  const limits = [2, 3, 7, 23, 24, 50, 140, 280, 281];

  it('holds for 400 random texts', () => {
    const rand = mulberry32(20261028);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;

    for (let run = 0; run < 400; run++) {
      const n = 1 + Math.floor(rand() * 120);
      let text = '';
      for (let i = 0; i < n; i++) text += pick(tokens) + pick(separators);
      const limit = pick(limits);

      const items = splitIntoThread(text, limit);
      try {
        expect(items.length).toBeGreaterThan(0);
        expectValidThread(items, text, limit);
      } catch (err) {
        throw new Error(`run ${run}, limit ${limit}, text ${JSON.stringify(text)}: ${String(err)}`);
      }
    }
    // Bulk loop with adversarial inputs (tiny limits, long URLs); a few seconds on a slow CI runner.
  }, 30_000);
});
