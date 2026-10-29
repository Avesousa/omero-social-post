// Minimal typings for the parts of `twitter-text` this package uses.
// `@types/twitter-text` models named exports, but the package only ships a default export
// (CJS `module.exports = {...}` and ESM `export default {...}`), so a default import is the
// only form that works in Node CJS, Node ESM and bundlers alike. Only `src/text/` imports it.
declare module 'twitter-text' {
  interface ParsedTweet {
    weightedLength: number;
    permillage: number;
    valid: boolean;
    displayRangeStart: number;
    displayRangeEnd: number;
    validRangeStart: number;
    validRangeEnd: number;
  }

  interface TwitterText {
    parseTweet(text: string): ParsedTweet;
    extractUrls(text: string): string[];
  }

  const twitterText: TwitterText;
  export default twitterText;
}
