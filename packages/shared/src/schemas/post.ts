import { z } from 'zod';

/** Hard ceiling on any text field, above every provider limit, to bound request size. */
export const MAX_TEXT_LENGTH = 30_000;
/** Hard ceiling on media ids per item or per base content. */
export const MAX_MEDIA_IDS = 20;
/** Hard ceiling on channels per post. */
export const MAX_CHANNELS_PER_POST = 10;
/** Hard ceiling on items per delivery (X thread length). */
export const MAX_ITEMS_PER_DELIVERY = 50;

const mediaIdsSchema = z.array(z.uuid()).max(MAX_MEDIA_IDS);

/** One publishable unit: a single post, or one entry of an X thread. */
export const postItemInputSchema = z.object({
  text: z.string().max(MAX_TEXT_LENGTH),
  mediaIds: mediaIdsSchema.default([]),
});
export type PostItemInput = z.infer<typeof postItemInputSchema>;

/** Per-channel part of a post. When `customized` is false, items are derived from the base content. */
export const postChannelInputSchema = z
  .object({
    channelId: z.uuid(),
    customized: z.boolean(),
    items: z.array(postItemInputSchema).max(MAX_ITEMS_PER_DELIVERY).optional(),
  })
  .refine((ch) => !ch.customized || (ch.items !== undefined && ch.items.length > 0), {
    message: 'items are required when the channel is customized',
    path: ['items'],
  });
export type PostChannelInput = z.infer<typeof postChannelInputSchema>;

/** Body of `POST /posts` and `PUT /posts/:id`. */
export const postInputSchema = z.object({
  version: z.int().nonnegative().optional(),
  baseContent: z.string().max(MAX_TEXT_LENGTH),
  baseMediaIds: mediaIdsSchema.default([]),
  channels: z.array(postChannelInputSchema).max(MAX_CHANNELS_PER_POST),
});
export type PostInput = z.infer<typeof postInputSchema>;
