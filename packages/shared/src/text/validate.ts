import { type FieldError } from '../errors';
import { getCharLimit, PROVIDER_LIMITS, type ProviderId, type ProviderLimits } from '../providers';
import { type PostChannelInput, type PostInput, type PostItemInput } from '../schemas/post';
import { splitIntoThread } from './thread';
import { countCharacters } from './x-text';

/** Field-level validation codes used in `FieldError.code` by `validatePostInput`. */
export const POST_VALIDATION_CODES = [
  'NO_CHANNELS',
  'DUPLICATE_CHANNEL',
  'UNKNOWN_CHANNEL',
  'ITEMS_REQUIRED',
  'TOO_MANY_ITEMS',
  'EMPTY_ITEM',
  'TEXT_TOO_LONG',
  'TOO_MANY_IMAGES',
  'MEDIA_NOT_FOUND',
  'UNSUPPORTED_MEDIA_TYPE',
  'MEDIA_TOO_LARGE',
] as const;
export type PostValidationCode = (typeof POST_VALIDATION_CODES)[number];

/** What validation needs to know about a connected channel. */
export interface ChannelContext {
  id: string;
  provider: ProviderId;
  settings: { longPostsEnabled: boolean };
}

/** Limits for every provider, keyed by provider id. */
export type ProviderLimitsMap = Readonly<Record<ProviderId, ProviderLimits>>;

/** Media metadata used for per-provider mime and size checks. */
export interface MediaInfo {
  mime: string;
  bytes: number;
}

export interface ValidatePostOptions {
  /**
   * Known media by id. When given, every referenced media id is checked against the provider's
   * allowed mime types and max bytes; when omitted, only image counts are checked.
   */
  media?: ReadonlyMap<string, MediaInfo>;
}

export interface PostValidationResult {
  valid: boolean;
  /** Errors with dotted paths such as `channels.0.items.1.text`. */
  errors: FieldError[];
}

/**
 * Items a channel will publish. A customized channel uses its own items; otherwise items are
 * derived from the base content: one item for single-post providers (LinkedIn), an automatic
 * thread split at the channel's limit for thread providers (X). Base media goes on the first item.
 * Never returns an empty array for a non-customized channel, so validation can flag empty content.
 */
export function deriveItems(
  base: Pick<PostInput, 'baseContent' | 'baseMediaIds'>,
  channelInput: Pick<PostChannelInput, 'customized' | 'items'>,
  channel: Pick<ChannelContext, 'provider' | 'settings'>,
  limits: ProviderLimitsMap = PROVIDER_LIMITS,
): PostItemInput[] {
  if (channelInput.customized) {
    return (channelInput.items ?? []).map((item) => ({
      text: item.text,
      mediaIds: [...item.mediaIds],
    }));
  }

  const providerLimits = limits[channel.provider];
  const texts = providerLimits.supportsThreads
    ? splitIntoThread(base.baseContent, getCharLimit(providerLimits, channel.settings))
    : [base.baseContent.trim()];
  if (texts.length === 0) texts.push('');

  return texts.map((text, i) => ({ text, mediaIds: i === 0 ? [...base.baseMediaIds] : [] }));
}

/**
 * Validates a post against each selected channel's provider limits, as the composer and the API
 * do before scheduling. `channels` are the known channels; unknown ids are reported as errors.
 */
export function validatePostInput(
  input: PostInput,
  channels: readonly ChannelContext[],
  limits: ProviderLimitsMap = PROVIDER_LIMITS,
  options: ValidatePostOptions = {},
): PostValidationResult {
  const errors: FieldError[] = [];
  const byId = new Map(channels.map((ch) => [ch.id, ch]));
  const seen = new Set<string>();

  if (input.channels.length === 0) {
    errors.push({ path: 'channels', code: 'NO_CHANNELS', message: 'Select at least one channel.' });
  }

  input.channels.forEach((channelInput, ci) => {
    const base = `channels.${ci}`;

    if (seen.has(channelInput.channelId)) {
      errors.push({
        path: `${base}.channelId`,
        code: 'DUPLICATE_CHANNEL',
        message: 'This channel is selected more than once.',
      });
      return;
    }
    seen.add(channelInput.channelId);

    const channel = byId.get(channelInput.channelId);
    if (!channel) {
      errors.push({
        path: `${base}.channelId`,
        code: 'UNKNOWN_CHANNEL',
        message: 'Unknown channel.',
      });
      return;
    }

    const providerLimits = limits[channel.provider];
    const items = deriveItems(input, channelInput, channel, limits);

    if (items.length === 0) {
      errors.push({
        path: `${base}.items`,
        code: 'ITEMS_REQUIRED',
        message: 'A customized channel needs at least one item.',
      });
      return;
    }
    if (!providerLimits.supportsThreads && items.length > 1) {
      errors.push({
        path: `${base}.items`,
        code: 'TOO_MANY_ITEMS',
        message: `${channel.provider} publishes exactly one item.`,
        params: { max: 1, count: items.length },
      });
    }

    const charLimit = getCharLimit(providerLimits, channel.settings);
    items.forEach((item, ii) => {
      errors.push(...validateItem(item, `${base}.items.${ii}`, providerLimits, charLimit, options));
    });
  });

  return { valid: errors.length === 0, errors };
}

function validateItem(
  item: PostItemInput,
  path: string,
  limits: ProviderLimits,
  charLimit: number,
  options: ValidatePostOptions,
): FieldError[] {
  const errors: FieldError[] = [];

  if (item.text.trim().length === 0 && item.mediaIds.length === 0) {
    errors.push({
      path: `${path}.text`,
      code: 'EMPTY_ITEM',
      message: 'Write some text or attach an image.',
    });
  }

  const length = countCharacters(item.text, limits);
  if (length > charLimit) {
    errors.push({
      path: `${path}.text`,
      code: 'TEXT_TOO_LONG',
      message: `Text is ${length} characters; the limit is ${charLimit}.`,
      params: { length, limit: charLimit },
    });
  }

  if (item.mediaIds.length > limits.maxImagesPerItem) {
    errors.push({
      path: `${path}.mediaIds`,
      code: 'TOO_MANY_IMAGES',
      message: `At most ${limits.maxImagesPerItem} images per item.`,
      params: { max: limits.maxImagesPerItem, count: item.mediaIds.length },
    });
  }

  if (options.media) {
    item.mediaIds.forEach((mediaId, mi) => {
      const media = options.media?.get(mediaId);
      const mediaPath = `${path}.mediaIds.${mi}`;
      if (!media) {
        errors.push({ path: mediaPath, code: 'MEDIA_NOT_FOUND', message: 'Image not found.' });
        return;
      }
      if (!limits.allowedMimeTypes.includes(media.mime)) {
        errors.push({
          path: mediaPath,
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: `Image type ${media.mime} is not supported by this network.`,
          params: { mime: media.mime },
        });
      }
      if (media.bytes > limits.maxImageBytes) {
        errors.push({
          path: mediaPath,
          code: 'MEDIA_TOO_LARGE',
          message: `Image is larger than ${limits.maxImageBytes} bytes.`,
          params: { bytes: media.bytes, max: limits.maxImageBytes },
        });
      }
    });
  }

  return errors;
}
