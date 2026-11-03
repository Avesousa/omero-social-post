import {
  channelSettingsSchema,
  channelStatusSchema,
  providerIdSchema,
  updateChannelSchema,
} from '@omero/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// No `.meta({ id })` on DTO root schemas (see CONVENTIONS.md).

const isoDateTime = z.iso.datetime({ offset: true });

/** A connected account as the UI sees it. Tokens never leave the API. */
export const channelViewSchema = z.object({
  id: z.uuid(),
  provider: providerIdSchema,
  externalId: z.string(),
  handle: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  status: channelStatusSchema,
  settings: channelSettingsSchema,
  /** When the access token expires; null when unknown or disconnected. */
  tokenExpiresAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type ChannelView = z.infer<typeof channelViewSchema>;
export class ChannelDto extends createZodDto(channelViewSchema) {}

export class ChannelIdParamDto extends createZodDto(z.object({ id: z.uuid() })) {}
export class ProviderParamDto extends createZodDto(z.object({ provider: providerIdSchema })) {}

/** Body of `PATCH /channels/:id` (the schema is shared with the web). */
export class UpdateChannelDto extends createZodDto(updateChannelSchema) {}

/**
 * Query the network appends to the callback URL. Every field is lenient: a malformed
 * value must end in a redirect with `?error=`, never in a JSON validation error.
 */
const lenient = z.string().max(2048).optional().catch(undefined);
export const oauthCallbackQuerySchema = z.object({
  code: lenient,
  state: lenient,
  /** Set by the network when the owner denied access or something failed on its side. */
  error: lenient,
  error_description: lenient,
});
export class OAuthCallbackQueryDto extends createZodDto(oauthCallbackQuerySchema) {}
