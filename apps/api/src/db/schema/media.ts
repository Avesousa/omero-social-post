import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, id } from './columns';

export const media = pgTable('media', {
  id: id(),
  /** Random key inside MEDIA_DIR (StorageAdapter), never derived from the upload name. */
  storageKey: text('storage_key').notNull().unique(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  width: integer('width'),
  height: integer('height'),
  /** Hex sha256 of the stored bytes, used to deduplicate uploads. */
  sha256: text('sha256').notNull().unique(),
  createdAt: createdAt(),
});
