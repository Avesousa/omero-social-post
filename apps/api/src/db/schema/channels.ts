import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { createdAt, id, tstz, updatedAt } from './columns';
import { channelStatusEnum, providerEnum } from './enums';

export interface ChannelSettings {
  /** X only: allow items above 280 weighted chars (X Premium long posts). */
  longPostsEnabled: boolean;
}

export const channels = pgTable(
  'channels',
  {
    id: id(),
    provider: providerEnum('provider').notNull(),
    /** Account id on the network (X user id, LinkedIn person `sub`). */
    externalId: text('external_id').notNull(),
    handle: text('handle').notNull(),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    status: channelStatusEnum('status').notNull().default('connected'),
    /** AES-256-GCM ciphertext (`v1:<iv>:<tag>:<data>`), see TokenCipher. Null once disconnected. */
    accessTokenEnc: text('access_token_enc'),
    refreshTokenEnc: text('refresh_token_enc'),
    tokenExpiresAt: tstz('token_expires_at'),
    refreshExpiresAt: tstz('refresh_expires_at'),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    settings: jsonb('settings')
      .$type<ChannelSettings>()
      .notNull()
      .default({ longPostsEnabled: false }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('channels_provider_external_id_unique').on(t.provider, t.externalId)],
);
