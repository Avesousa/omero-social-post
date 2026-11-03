import twitterText from 'twitter-text';
import { describe, expect, it } from 'vitest';
import {
  containsUrl,
  countCharacters,
  getCharLimit,
  getXCharLimit,
  PROVIDER_LIMITS,
  xWeightedLength,
} from '../src';

describe('xWeightedLength', () => {
  it('counts Latin text one per character', () => {
    expect(xWeightedLength('')).toBe(0);
    expect(xWeightedLength('hello world')).toBe(11);
  });

  it('counts any URL as 23', () => {
    expect(xWeightedLength('https://example.com')).toBe(23);
    expect(xWeightedLength(`https://example.com/${'a'.repeat(200)}`)).toBe(23);
    expect(xWeightedLength('see https://t.co/x')).toBe(4 + 23);
    // Bare domains are links on X too.
    expect(xWeightedLength('example.com')).toBe(23);
  });

  it('counts CJK characters as 2', () => {
    expect(xWeightedLength('你好')).toBe(4);
    expect(xWeightedLength('こんにちは')).toBe(10);
    expect(xWeightedLength('안녕')).toBe(4);
  });

  it('counts emoji as 2, including ZWJ sequences, flags and skin tones', () => {
    expect(xWeightedLength('😀')).toBe(2);
    expect(xWeightedLength('👨‍👩‍👧‍👦')).toBe(2);
    expect(xWeightedLength('🇦🇷')).toBe(2);
    expect(xWeightedLength('👍🏽')).toBe(2);
    expect(xWeightedLength('café ☕️')).toBe(5 + 2);
  });

  it('normalizes to NFC before counting', () => {
    expect(xWeightedLength('café')).toBe(4);
  });

  it('mixes rules', () => {
    expect(xWeightedLength('hello https://example.com 你好 😀')).toBe(6 + 23 + 1 + 4 + 1 + 2);
  });

  it('agrees with twitter-text on the ASCII fast path', () => {
    const samples = [
      'plain ascii text with symbols !@#$%^&*()_+-=[]{};:",<>/?`~|\\',
      'tabs\tand\nnewlines',
      'https://example',
      '#hashtag @mention $CASH',
      'x'.repeat(500),
    ];
    for (const s of samples)
      expect(xWeightedLength(s)).toBe(twitterText.parseTweet(s).weightedLength);
  });
});

describe('exact-limit boundaries', () => {
  it('fits exactly 280 Latin characters, not 281', () => {
    expect(xWeightedLength('a'.repeat(280))).toBe(280);
    expect(xWeightedLength('a'.repeat(281))).toBe(281);
  });

  it('fits exactly 140 CJK characters, not 141', () => {
    expect(xWeightedLength('你'.repeat(140))).toBe(280);
    expect(xWeightedLength('你'.repeat(141))).toBe(282);
  });

  it('fits 140 emoji', () => {
    expect(xWeightedLength('😀'.repeat(140))).toBe(280);
  });
});

describe('limits', () => {
  it('uses 280 by default and 25,000 with long posts', () => {
    expect(getXCharLimit()).toBe(280);
    expect(getXCharLimit(true)).toBe(25_000);
    expect(getCharLimit(PROVIDER_LIMITS.x, { longPostsEnabled: false })).toBe(280);
    expect(getCharLimit(PROVIDER_LIMITS.x, { longPostsEnabled: true })).toBe(25_000);
  });

  it('ignores longPostsEnabled for LinkedIn', () => {
    expect(getCharLimit(PROVIDER_LIMITS.linkedin, { longPostsEnabled: true })).toBe(3_000);
  });

  it('counts plain length for non-weighted providers', () => {
    expect(countCharacters('https://example.com', PROVIDER_LIMITS.linkedin)).toBe(19);
    expect(countCharacters('https://example.com', PROVIDER_LIMITS.x)).toBe(23);
  });
});

describe('containsUrl', () => {
  it('detects URLs with and without protocol', () => {
    expect(containsUrl('read https://example.com/post')).toBe(true);
    expect(containsUrl('read example.com')).toBe(true);
  });

  it('ignores text without URLs', () => {
    expect(containsUrl('')).toBe(false);
    expect(containsUrl('no links here. Just words, @mentions and #tags')).toBe(false);
  });
});
