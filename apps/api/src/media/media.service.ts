import { buffer as readAll } from 'node:stream/consumers';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type ProviderLimits } from '@omero/shared';
import { eq, inArray } from 'drizzle-orm';
import { ProblemException } from '../common/errors/problem.exception';
import { type Database, DRIZZLE } from '../db/db.module';
import { media } from '../db/schema';
import {
  extensionFor,
  type ImageMime,
  isImageMime,
  type PreparedImage,
  prepareImageForProvider,
  processUpload,
} from './image-pipeline';
import { newStorageKey } from './storage/local-disk.storage';
import { STORAGE_ADAPTER, type StorageAdapter, type StoredObject } from './storage/storage-adapter';

export type MediaRow = typeof media.$inferSelect;

/** Public representation of a media row (body of `POST /media`). */
export interface MediaView {
  id: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  url: string;
}

/** Same-origin URL the web and the API serve a media file from. */
export function mediaUrl(id: string): string {
  return `/api/v1/media/${id}`;
}

export function toMediaView(row: MediaRow): MediaView {
  return {
    id: row.id,
    mime: row.mime,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    url: mediaUrl(row.id),
  };
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  /**
   * Normalizes and stores an uploaded image. The same processed bytes always map to the
   * same media row (sha256 dedupe), so uploading an image twice returns the first row.
   * Throws `ImageRejectedError` for files that are not acceptable images.
   */
  async upload(input: Buffer): Promise<MediaRow> {
    const image = await processUpload(input);

    const existing = await this.findBySha256(image.sha256);
    if (existing) return existing;

    const storageKey = newStorageKey(extensionFor(image.mime));
    await this.storage.put(storageKey, image.data, image.mime);

    const [inserted] = await this.db
      .insert(media)
      .values({
        storageKey,
        mime: image.mime,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
        sha256: image.sha256,
      })
      .onConflictDoNothing({ target: media.sha256 })
      .returning();
    if (inserted) return inserted;

    // A concurrent upload of the same image won the race: keep its row, drop our file.
    await this.storage.delete(storageKey);
    const winner = await this.findBySha256(image.sha256);
    if (!winner) throw new Error('media row vanished after a sha256 conflict');
    return winner;
  }

  async findById(id: string): Promise<MediaRow | undefined> {
    const [row] = await this.db.select().from(media).where(eq(media.id, id));
    return row;
  }

  /** Rows for the given ids (missing ids are simply absent), in one query. */
  async findManyByIds(ids: readonly string[]): Promise<MediaRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(media)
      .where(inArray(media.id, [...new Set(ids)]));
  }

  /** Opens a media file for streaming. 404 when the row or the file is missing. */
  async open(id: string): Promise<{ media: MediaRow } & StoredObject> {
    const row = await this.findById(id);
    if (!row) throw ProblemException.notFound('Media not found.');
    try {
      return { media: row, ...(await this.storage.get(row.storageKey)) };
    } catch (err) {
      this.logger.warn({ err, mediaId: id }, 'Media file missing from storage');
      throw ProblemException.notFound('Media not found.');
    }
  }

  /** Whole file in memory, for provider uploads (images are at most 15 MB). */
  async getBuffer(id: string): Promise<{ buffer: Buffer; mime: ImageMime; media: MediaRow }> {
    const { media: row, stream } = await this.open(id);
    if (!isImageMime(row.mime))
      throw new Error(`Stored media ${id} has unexpected mime ${row.mime}`);
    return { buffer: await readAll(stream), mime: row.mime, media: row };
  }

  /**
   * The media file adapted to one network's limits: WebP becomes JPEG where it is not
   * accepted (LinkedIn), and files above `maxImageBytes` are re-encoded until they fit.
   */
  async prepareForProvider(
    mediaId: string,
    limits: Pick<ProviderLimits, 'allowedMimeTypes' | 'maxImageBytes'>,
  ): Promise<PreparedImage> {
    const { buffer, mime } = await this.getBuffer(mediaId);
    return prepareImageForProvider(buffer, mime, limits);
  }

  private async findBySha256(sha256: string): Promise<MediaRow | undefined> {
    const [row] = await this.db.select().from(media).where(eq(media.sha256, sha256));
    return row;
  }
}
