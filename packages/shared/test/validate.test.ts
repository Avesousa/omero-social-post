import { describe, expect, it } from 'vitest';
import {
  deriveItems,
  PROVIDER_LIMITS,
  validatePostInput,
  type ChannelContext,
  type MediaInfo,
  type PostInput,
} from '../src';

const X_ID = '0192f3a0-0000-7000-8000-000000000001';
const X_PREMIUM_ID = '0192f3a0-0000-7000-8000-000000000002';
const LI_ID = '0192f3a0-0000-7000-8000-000000000003';
const UNKNOWN_ID = '0192f3a0-0000-7000-8000-0000000000ff';
const media = (n: number) =>
  Array.from({ length: n }, (_, i) => `0192f3a0-0000-7000-9000-${String(i).padStart(12, '0')}`);

const channels: ChannelContext[] = [
  { id: X_ID, provider: 'x', settings: { longPostsEnabled: false } },
  { id: X_PREMIUM_ID, provider: 'x', settings: { longPostsEnabled: true } },
  { id: LI_ID, provider: 'linkedin', settings: { longPostsEnabled: false } },
];

function post(overrides: Partial<PostInput> = {}): PostInput {
  return { baseContent: 'Hello world', baseMediaIds: [], channels: [], ...overrides };
}

const paths = (input: PostInput, opts?: Parameters<typeof validatePostInput>[3]) =>
  validatePostInput(input, channels, PROVIDER_LIMITS, opts).errors.map(
    (e) => `${e.path}:${e.code}`,
  );

describe('deriveItems', () => {
  it('auto-splits base content into a thread for X, with base media on the first item', () => {
    const base = {
      baseContent: `${'a'.repeat(200)}\n\n${'b'.repeat(200)}`,
      baseMediaIds: media(2),
    };
    const items = deriveItems(base, { customized: false }, channels[0]!);
    expect(items).toEqual([
      { text: 'a'.repeat(200), mediaIds: media(2) },
      { text: 'b'.repeat(200), mediaIds: [] },
    ]);
  });

  it('uses the long-post limit when the X channel has it enabled', () => {
    const base = { baseContent: 'a '.repeat(500).trim(), baseMediaIds: [] };
    expect(deriveItems(base, { customized: false }, channels[0]!).length).toBeGreaterThan(1);
    expect(deriveItems(base, { customized: false }, channels[1]!)).toHaveLength(1);
  });

  it('produces exactly one item for LinkedIn', () => {
    const base = {
      baseContent: `  ${'a'.repeat(200)}\n\n${'b'.repeat(200)}  `,
      baseMediaIds: media(1),
    };
    expect(deriveItems(base, { customized: false }, channels[2]!)).toEqual([
      { text: `${'a'.repeat(200)}\n\n${'b'.repeat(200)}`, mediaIds: media(1) },
    ]);
  });

  it('returns one empty item for blank, non-customized content', () => {
    const base = { baseContent: '   ', baseMediaIds: [] };
    expect(deriveItems(base, { customized: false }, channels[0]!)).toEqual([
      { text: '', mediaIds: [] },
    ]);
  });

  it('returns a copy of the custom items when customized', () => {
    const items = [{ text: 'custom', mediaIds: media(1) }];
    const derived = deriveItems(post(), { customized: true, items }, channels[0]!);
    expect(derived).toEqual(items);
    expect(derived[0]).not.toBe(items[0]);
  });

  it('honours injected limits', () => {
    const limits = { ...PROVIDER_LIMITS, x: { ...PROVIDER_LIMITS.x, maxChars: 10 } };
    const items = deriveItems(
      post({ baseContent: 'one two three four' }),
      { customized: false },
      channels[0]!,
      limits,
    );
    expect(items.map((i) => i.text)).toEqual(['one two', 'three four']);
  });
});

describe('validatePostInput', () => {
  it('accepts a post for X and LinkedIn derived from base content', () => {
    const input = post({
      baseContent: 'A long post. '.repeat(40),
      baseMediaIds: media(2),
      channels: [
        { channelId: X_ID, customized: false },
        { channelId: LI_ID, customized: false },
      ],
    });
    expect(validatePostInput(input, channels)).toEqual({ valid: true, errors: [] });
  });

  it('accepts an X thread override with a LinkedIn base post', () => {
    const input = post({
      channels: [
        {
          channelId: X_ID,
          customized: true,
          items: [
            { text: 'one', mediaIds: [] },
            { text: 'two', mediaIds: [] },
            { text: 'three', mediaIds: [] },
          ],
        },
        { channelId: LI_ID, customized: false },
      ],
    });
    expect(validatePostInput(input, channels).valid).toBe(true);
  });

  it('requires at least one channel', () => {
    expect(paths(post())).toEqual(['channels:NO_CHANNELS']);
  });

  it('reports unknown and duplicate channels', () => {
    const input = post({
      channels: [
        { channelId: X_ID, customized: false },
        { channelId: UNKNOWN_ID, customized: false },
        { channelId: X_ID, customized: false },
      ],
    });
    expect(paths(input)).toEqual([
      'channels.1.channelId:UNKNOWN_CHANNEL',
      'channels.2.channelId:DUPLICATE_CHANNEL',
    ]);
  });

  it('flags an X item over 280 on a standard channel, with params', () => {
    const input = post({
      channels: [
        {
          channelId: X_ID,
          customized: true,
          items: [
            { text: 'fine', mediaIds: [] },
            { text: 'a'.repeat(281), mediaIds: [] },
          ],
        },
      ],
    });
    const { valid, errors } = validatePostInput(input, channels);
    expect(valid).toBe(false);
    expect(errors).toEqual([
      expect.objectContaining({
        path: 'channels.0.items.1.text',
        code: 'TEXT_TOO_LONG',
        params: { length: 281, limit: 280 },
      }),
    ]);
  });

  it('accepts exactly 280 weighted characters on X, and long posts on Premium channels', () => {
    const at = (text: string, channelId: string) =>
      post({ channels: [{ channelId, customized: true, items: [{ text, mediaIds: [] }] }] });
    expect(paths(at('你'.repeat(140), X_ID))).toEqual([]);
    expect(paths(at('你'.repeat(141), X_ID))).toEqual(['channels.0.items.0.text:TEXT_TOO_LONG']);
    expect(paths(at('a'.repeat(25_000), X_PREMIUM_ID))).toEqual([]);
    expect(paths(at('a'.repeat(25_001), X_PREMIUM_ID))).toEqual([
      'channels.0.items.0.text:TEXT_TOO_LONG',
    ]);
  });

  it('counts URLs as 23 on X but as plain length on LinkedIn', () => {
    const url = `https://example.com/${'p'.repeat(2_990)}`;
    const input = post({
      baseContent: url,
      channels: [
        { channelId: X_ID, customized: false },
        { channelId: LI_ID, customized: false },
      ],
    });
    expect(paths(input)).toEqual(['channels.1.items.0.text:TEXT_TOO_LONG']);
  });

  it('enforces 3000 characters for LinkedIn base content', () => {
    const ok = post({
      baseContent: 'a'.repeat(3_000),
      channels: [{ channelId: LI_ID, customized: false }],
    });
    const tooLong = post({
      baseContent: 'a'.repeat(3_001),
      channels: [{ channelId: LI_ID, customized: false }],
    });
    expect(paths(ok)).toEqual([]);
    expect(paths(tooLong)).toEqual(['channels.0.items.0.text:TEXT_TOO_LONG']);
  });

  it('allows exactly one LinkedIn item', () => {
    const input = post({
      channels: [
        {
          channelId: LI_ID,
          customized: true,
          items: [
            { text: 'one', mediaIds: [] },
            { text: 'two', mediaIds: [] },
          ],
        },
      ],
    });
    expect(paths(input)).toEqual(['channels.0.items:TOO_MANY_ITEMS']);
  });

  it('requires items on customized channels', () => {
    const input = post({ channels: [{ channelId: X_ID, customized: true, items: [] }] });
    expect(paths(input)).toEqual(['channels.0.items:ITEMS_REQUIRED']);
  });

  it('flags empty items but allows image-only items', () => {
    const input = post({
      channels: [
        {
          channelId: X_ID,
          customized: true,
          items: [
            { text: '  ', mediaIds: [] },
            { text: '', mediaIds: media(1) },
          ],
        },
      ],
    });
    expect(paths(input)).toEqual(['channels.0.items.0.text:EMPTY_ITEM']);
    expect(
      paths(post({ baseContent: '', channels: [{ channelId: LI_ID, customized: false }] })),
    ).toEqual(['channels.0.items.0.text:EMPTY_ITEM']);
  });

  it('limits X to 4 images per item and LinkedIn to 20', () => {
    const at = (n: number) =>
      post({
        baseMediaIds: media(n),
        channels: [
          { channelId: X_ID, customized: false },
          { channelId: LI_ID, customized: false },
        ],
      });
    expect(paths(at(4))).toEqual([]);
    expect(paths(at(5))).toEqual(['channels.0.items.0.mediaIds:TOO_MANY_IMAGES']);
    expect(paths(at(20))).toEqual(['channels.0.items.0.mediaIds:TOO_MANY_IMAGES']);
    expect(PROVIDER_LIMITS.linkedin.maxImagesPerItem).toBe(20);
  });

  it('checks mime types and sizes per provider when media metadata is given', () => {
    const [jpeg, webp, huge, missing] = media(4) as [string, string, string, string];
    const known = new Map<string, MediaInfo>([
      [jpeg, { mime: 'image/jpeg', bytes: 100_000 }],
      [webp, { mime: 'image/webp', bytes: 100_000 }],
      [huge, { mime: 'image/png', bytes: 8 * 1024 * 1024 }],
    ]);
    const input = post({
      baseMediaIds: [jpeg, webp, huge, missing],
      channels: [
        { channelId: X_ID, customized: false },
        { channelId: LI_ID, customized: false },
      ],
    });
    expect(paths(input, { media: known })).toEqual([
      'channels.0.items.0.mediaIds.2:MEDIA_TOO_LARGE',
      'channels.0.items.0.mediaIds.3:MEDIA_NOT_FOUND',
      'channels.1.items.0.mediaIds.1:UNSUPPORTED_MEDIA_TYPE',
      'channels.1.items.0.mediaIds.3:MEDIA_NOT_FOUND',
    ]);
  });
});
