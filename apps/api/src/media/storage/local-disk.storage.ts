import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { uuidv7 } from 'uuidv7';
import { type StorageAdapter, StorageNotFoundError, type StoredObject } from './storage-adapter';

/** `<uuidv7>.<ext>`: the only key shape accepted, so a key can never escape MEDIA_DIR. */
const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$/;

/** A new random storage key, e.g. `0192f3c4-...-a1b2.jpg`. */
export function newStorageKey(extension: string): string {
  return `${uuidv7()}.${extension}`;
}

/**
 * Stores objects as files under `rootDir`, sharded into 256 sub-directories so no
 * single directory grows unbounded.
 *
 * The shard is the first two characters of the key's random tail (the last two hex digits
 * of the UUID). The literal first two characters of a UUIDv7 are timestamp bits that stay
 * the same for decades, so they would put every file in one directory.
 */
export class LocalDiskStorage implements StorageAdapter {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  async put(key: string, data: Buffer, _mime: string): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    // Write to a temp file and rename, so readers never see a partially written file.
    const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(tmp, data, { flag: 'wx', mode: 0o640 });
      await rename(tmp, path);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  async get(key: string): Promise<StoredObject> {
    const path = this.pathFor(key);
    try {
      const info = await stat(path);
      return { stream: createReadStream(path), size: info.size };
    } catch (err) {
      if (isNotFound(err)) throw new StorageNotFoundError(key);
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.pathFor(key))).isFile();
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  /** Absolute file path for a key. Exposed for tests and maintenance scripts. */
  pathFor(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error(`Invalid storage key: ${key}`);
    const dot = key.lastIndexOf('.');
    const shard = key.slice(dot - 2, dot);
    return join(this.root, shard, key);
  }
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}
