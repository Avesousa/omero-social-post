import { z } from 'zod';

export const PROVIDER_IDS = ['x', 'linkedin'] as const;
export const providerIdSchema = z.enum(PROVIDER_IDS);
export type ProviderId = z.infer<typeof providerIdSchema>;

/** Per-network publishing limits. Served by `GET /providers` and used by the composer and the API. */
export const providerLimitsSchema = z.object({
  /** Character limit for a single item on a standard account. */
  maxChars: z.int().positive(),
  /** Character limit when the channel has `longPostsEnabled` (e.g. X Premium). Absent when not applicable. */
  longPostMaxChars: z.int().positive().optional(),
  /** True when length uses the X weighted rules (URLs = 23, wide chars = 2) instead of plain length. */
  weightedCounting: z.boolean(),
  maxImagesPerItem: z.int().nonnegative(),
  maxImageBytes: z.int().positive(),
  allowedMimeTypes: z.array(z.string()),
  /** True when a delivery can be a thread of several items (X); false means exactly one item. */
  supportsThreads: z.boolean(),
});
export type ProviderLimits = z.infer<typeof providerLimitsSchema>;

export const X_DEFAULT_CHAR_LIMIT = 280;
export const X_LONG_POST_CHAR_LIMIT = 25_000;
export const LINKEDIN_CHAR_LIMIT = 3_000;

const MB = 1024 * 1024;

// Verified 2026-10-29 (T018/T019):
// - X: 4 photos per post, images <= 5 MB, JPG/PNG/GIF/WEBP
//   (https://docs.x.com/x-api/media/introduction, https://docs.x.com/x-api/media/quickstart/best-practices).
// - LinkedIn: multi-image posts take 2-20 images; JPG/GIF/PNG under 36,152,320 pixels. LinkedIn documents
//   no byte limit, so 10 MB is our own conservative cap
//   (https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/multiimage-post-api,
//   https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api).
export const PROVIDER_LIMITS: Readonly<Record<ProviderId, ProviderLimits>> = {
  x: {
    maxChars: X_DEFAULT_CHAR_LIMIT,
    longPostMaxChars: X_LONG_POST_CHAR_LIMIT,
    weightedCounting: true,
    maxImagesPerItem: 4,
    maxImageBytes: 5 * MB,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    supportsThreads: true,
  },
  linkedin: {
    maxChars: LINKEDIN_CHAR_LIMIT,
    weightedCounting: false,
    maxImagesPerItem: 20,
    maxImageBytes: 10 * MB,
    // The LinkedIn Images API accepts JPG, PNG and GIF; WebP uploads must be converted by the media pipeline.
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif'],
    supportsThreads: false,
  },
};

/** Per-channel settings stored in `channels.settings`. */
export const channelSettingsSchema = z.object({
  longPostsEnabled: z.boolean().default(false),
});
export type ChannelSettings = z.infer<typeof channelSettingsSchema>;

/** Body of `PATCH /channels/:id`. */
export const updateChannelSchema = z.object({
  settings: channelSettingsSchema,
});
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;

/** Effective character limit for a provider given the channel settings. */
export function getCharLimit(
  limits: ProviderLimits,
  settings: Pick<ChannelSettings, 'longPostsEnabled'> = { longPostsEnabled: false },
): number {
  return settings.longPostsEnabled && limits.longPostMaxChars !== undefined
    ? limits.longPostMaxChars
    : limits.maxChars;
}
