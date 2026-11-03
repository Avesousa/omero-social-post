import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROVIDER_LIMITS } from '@omero/shared';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareImageForProvider } from './image-pipeline';
import { LocalDiskStorage, newStorageKey } from './storage/local-disk.storage';
import { StorageNotFoundError } from './storage/storage-adapter';

/** Random noise compresses badly, which makes byte limits easy to exceed. */
function noise(width: number, height: number): sharp.Sharp {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
  return sharp(raw, { raw: { width, height, channels: 3 } });
}

describe('prepareImageForProvider', () => {
  it('returns the input untouched when the network accepts it', async () => {
    const jpeg = await noise(50, 50).jpeg().toBuffer();
    const out = await prepareImageForProvider(jpeg, 'image/jpeg', PROVIDER_LIMITS.linkedin);
    expect(out.mime).toBe('image/jpeg');
    expect(out.buffer).toBe(jpeg);
  });

  it('converts WebP to JPEG for LinkedIn but keeps it for X', async () => {
    const webp = await noise(50, 50).webp().toBuffer();
    const linkedin = await prepareImageForProvider(webp, 'image/webp', PROVIDER_LIMITS.linkedin);
    expect(linkedin.mime).toBe('image/jpeg');
    expect((await sharp(linkedin.buffer).metadata()).format).toBe('jpeg');

    const x = await prepareImageForProvider(webp, 'image/webp', PROVIDER_LIMITS.x);
    expect(x).toEqual({ buffer: webp, mime: 'image/webp' });
  });

  it('re-encodes a JPEG above the max bytes until it fits', async () => {
    const jpeg = await noise(800, 800).jpeg({ quality: 100 }).toBuffer();
    const maxImageBytes = Math.floor(jpeg.length / 3);
    const out = await prepareImageForProvider(jpeg, 'image/jpeg', {
      allowedMimeTypes: ['image/jpeg'],
      maxImageBytes,
    });
    expect(out.mime).toBe('image/jpeg');
    expect(out.buffer.length).toBeLessThanOrEqual(maxImageBytes);
  });

  it('turns an oversized PNG into a JPEG when JPEG is accepted', async () => {
    const png = await noise(400, 400).png().toBuffer();
    const out = await prepareImageForProvider(png, 'image/png', {
      allowedMimeTypes: ['image/jpeg', 'image/png'],
      maxImageBytes: Math.floor(png.length / 2),
    });
    expect(out.mime).toBe('image/jpeg');
  });

  it('throws when no accepted type is available', async () => {
    const webp = await noise(10, 10).webp().toBuffer();
    await expect(
      prepareImageForProvider(webp, 'image/webp', {
        allowedMimeTypes: ['image/png'],
        maxImageBytes: 10,
      }),
    ).rejects.toThrow();
  });
});

describe('LocalDiskStorage', () => {
  let dir: string;
  let storage: LocalDiskStorage;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'omero-storage-'));
    storage = new LocalDiskStorage(dir);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('puts, gets, checks and deletes objects under a shard directory', async () => {
    const key = newStorageKey('png');
    await storage.put(key, Buffer.from('hello'), 'image/png');

    const path = storage.pathFor(key);
    expect(path.startsWith(join(dir, key.slice(34, 36)))).toBe(true);
    expect(await readFile(path, 'utf8')).toBe('hello');
    expect(await storage.exists(key)).toBe(true);

    const { stream, size } = await storage.get(key);
    expect(size).toBe(5);
    stream.destroy();

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
    await expect(storage.get(key)).rejects.toBeInstanceOf(StorageNotFoundError);
    await storage.delete(key); // idempotent
  });

  it('rejects keys that could escape the root directory', () => {
    expect(() => storage.pathFor('../../etc/passwd')).toThrow(/Invalid storage key/);
    expect(() => storage.pathFor('a/b.jpg')).toThrow(/Invalid storage key/);
  });
});
