import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { media } from '../../src/db/schema';
import { MAX_UPLOAD_BYTES } from '../../src/media/image-pipeline';
import type { LocalDiskStorage } from '../../src/media/storage/local-disk.storage';
import { STORAGE_ADAPTER } from '../../src/media/storage/storage-adapter';
import { createTestApp, type TestApp } from '../helpers/app';
import { type AuthedAgent, loginAs } from '../helpers/auth';
import { resetDb } from '../helpers/db';

/** A JPEG carrying EXIF with GPS coordinates and orientation 6 (rotate 90 degrees). */
async function jpegWithGps(): Promise<Buffer> {
  const plain = await sharp({
    create: { width: 40, height: 20, channels: 3, background: '#d04020' },
  })
    .jpeg()
    .withExif({
      IFD0: { Copyright: 'secret owner', Make: 'TestCam' },
      IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '34/1 36/1 0/1' },
    })
    .toBuffer();
  return sharp(plain).keepExif().withMetadata({ orientation: 6 }).jpeg().toBuffer();
}

/** A two-frame animated GIF (frames must differ or the encoder merges them). */
async function animatedGif(): Promise<Buffer> {
  const raw = Buffer.alloc(10 * 20 * 4);
  for (let i = 0; i < 200; i++) {
    raw[i * 4] = i < 100 ? 255 : 0;
    raw[i * 4 + 2] = i < 100 ? 0 : 255;
    raw[i * 4 + 3] = 255;
  }
  return sharp(raw, { raw: { width: 10, height: 20, channels: 4, pageHeight: 10 } })
    .gif({ delay: [100, 100], loop: 0 })
    .toBuffer();
}

describe('media', () => {
  let t: TestApp;
  let owner: AuthedAgent;
  let storage: LocalDiskStorage;

  beforeAll(async () => {
    t = await createTestApp({ env: { WORKERS_ENABLED: 'false' } });
    storage = t.app.get(STORAGE_ADAPTER);
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await resetDb(t.db);
    owner = await loginAs(t);
  });

  const upload = (data: Buffer, filename = 'photo.jpg') =>
    owner.http.post('/api/v1/media').attach('file', data, filename);

  it('strips EXIF/GPS, applies the orientation and stores the processed file', async () => {
    const source = await jpegWithGps();
    const sourceMeta = await sharp(source).metadata();
    expect(sourceMeta.exif).toBeDefined();
    expect(sourceMeta.orientation).toBe(6);

    const res = await upload(source).expect(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      mime: 'image/jpeg',
      bytes: expect.any(Number),
      // Orientation 6 means the 40x20 image displays as 20x40.
      width: 20,
      height: 40,
      url: `/api/v1/media/${res.body.id}`,
    });

    const [row] = await t.db.select().from(media).where(eq(media.id, res.body.id));
    const stored = await readFile(storage.pathFor(row!.storageKey));
    expect(stored.length).toBe(res.body.bytes);
    const meta = await sharp(stored).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(stored.includes('secret owner')).toBe(false);
    expect(stored.includes('TestCam')).toBe(false);
  });

  it('returns the same media row when the same image is uploaded twice', async () => {
    const source = await jpegWithGps();
    const first = await upload(source).expect(201);
    const second = await upload(source, 'renamed.jpg').expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await t.db.select().from(media)).toHaveLength(1);
  });

  it('accepts png, webp and static gif and keeps their format', async () => {
    const base = sharp({ create: { width: 30, height: 30, channels: 4, background: '#2050d0' } });
    for (const [data, mime] of [
      [await base.clone().png().toBuffer(), 'image/png'],
      [await base.clone().webp().toBuffer(), 'image/webp'],
      [await base.clone().gif().toBuffer(), 'image/gif'],
    ] as const) {
      const res = await upload(data, 'image.bin').expect(201);
      expect(res.body).toMatchObject({ mime, width: 30, height: 30 });
    }
  });

  it('downscales images whose longest side exceeds 4096 px', async () => {
    const big = await sharp({
      create: { width: 5000, height: 1000, channels: 3, background: '#808080' },
    })
      .png()
      .toBuffer();
    const res = await upload(big, 'wide.png').expect(201);
    expect(res.body).toMatchObject({ width: 4096, height: 819 });
  });

  it('rejects a text file renamed to .jpg with 415', async () => {
    const res = await upload(Buffer.from('just some text, not an image\n'.repeat(20)), 'evil.jpg')
      .expect(415)
      .expect('content-type', /application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('rejects animated GIFs with 415', async () => {
    const res = await upload(await animatedGif(), 'anim.gif').expect(415);
    expect(res.body.detail).toMatch(/GIF animation comes in a later stage/);
  });

  it('rejects files over 15 MB with 413', async () => {
    const res = await upload(Buffer.alloc(MAX_UPLOAD_BYTES + 1024, 0xff), 'huge.jpg').expect(413);
    expect(res.body).toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
    expect(await t.db.select().from(media)).toHaveLength(0);
  });

  it('rejects a request without a file with 400', async () => {
    await owner.http.post('/api/v1/media').field('other', 'x').expect(400);
  });

  it('streams the stored bytes with type and cache headers', async () => {
    const created = await upload(await jpegWithGps()).expect(201);
    const [row] = await t.db.select().from(media).where(eq(media.id, created.body.id));
    const stored = await readFile(storage.pathFor(row!.storageKey));

    const res = await owner.http
      .get(created.body.url)
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Number(res.headers['content-length'])).toBe(stored.length);
    expect(Buffer.compare(res.body as Buffer, stored)).toBe(0);
  });

  it('returns 404 for an unknown media id and 400 for a malformed one', async () => {
    await owner.http.get('/api/v1/media/01900000-0000-7000-8000-000000000000').expect(404);
    await owner.http.get('/api/v1/media/not-a-uuid').expect(400);
  });
});
