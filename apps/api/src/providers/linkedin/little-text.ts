/**
 * LinkedIn "little text format" for post commentary.
 * https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format
 *
 * Every reserved character must be backslash-escaped, otherwise LinkedIn may
 * truncate or misparse the text (e.g. everything after an unescaped "(").
 */
const RESERVED = /[\\|{}@[\]()<>#*_~]/g;

/** Hashtags at the start of the text or after whitespace: `#word` (letters, digits, `_`). */
const HASHTAG = /(^|\s)#([\p{L}\p{N}_]+)/gu;

export function escapeLittleText(text: string): string {
  return text.replace(RESERVED, (ch) => `\\${ch}`);
}

/**
 * Converts plain text to commentary: hashtags become `{hashtag|\#|tag}` templates so
 * they stay clickable, and every other reserved character is escaped.
 */
export function toLinkedInCommentary(text: string): string {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(HASHTAG)) {
    const [whole, lead = '', tag = ''] = match;
    const start = match.index ?? 0;
    out += escapeLittleText(text.slice(last, start)) + lead;
    out += `{hashtag|\\#|${escapeLittleText(tag)}}`;
    last = start + whole.length;
  }
  return out + escapeLittleText(text.slice(last));
}
