import twitterText from 'twitter-text';
import { X_DEFAULT_CHAR_LIMIT, X_LONG_POST_CHAR_LIMIT, type ProviderLimits } from '../providers';

// Thin wrapper around twitter-text so consumers never import it directly.

/**
 * Length of `text` as X counts it (twitter-text v3 rules): URLs count 23, CJK and emoji count 2,
 * most Latin characters count 1. Text is NFC-normalized before counting.
 */
export function xWeightedLength(text: string): number {
  if (text.length === 0) return 0;
  // Fast path: ASCII without a dot cannot hold a URL (a TLD needs one) or an emoji, and every
  // ASCII character weighs 1, so the weighted length is the plain length.
  if (ASCII_WITHOUT_DOT.test(text)) return text.length;
  return twitterText.parseTweet(text).weightedLength;
}

// eslint-disable-next-line no-control-regex
const ASCII_WITHOUT_DOT = /^[\x00-\x2d\x2f-\x7f]*$/;

/** X character limit for a channel: 280 by default, 25,000 with long posts (X Premium). */
export function getXCharLimit(longPostsEnabled = false): number {
  return longPostsEnabled ? X_LONG_POST_CHAR_LIMIT : X_DEFAULT_CHAR_LIMIT;
}

/** True when `text` contains at least one URL as X detects it (including bare domains such as `example.com`). */
export function containsUrl(text: string): boolean {
  if (text.length === 0) return false;
  return twitterText.extractUrls(text).length > 0;
}

/** Length of `text` under a provider's counting rules (weighted for X, UTF-16 length otherwise). */
export function countCharacters(
  text: string,
  limits: Pick<ProviderLimits, 'weightedCounting'>,
): number {
  // UTF-16 length is the conservative choice for plain-length providers: it is never below the code point count.
  return limits.weightedCounting ? xWeightedLength(text) : text.length;
}
