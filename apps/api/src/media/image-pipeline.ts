import { createHash } from 'node:crypto';
import { type ProviderLimits } from '@omero/shared';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

/** Upload ceiling (multer limit). Larger files get 413. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Longest side kept on upload; larger images are downscaled to fit. */
export const MAX_IMAGE_DIMENSION = 4096;
/**
 * Decoded-pixel ceiling (sharp `limitInputPixels`), so a small but huge-resolution file
 * cannot exhaust memory on a 4 GB box. 150 MP still covers 108 MP phone cameras.
 */
export const MAX_INPUT_PIXELS = 150_000_000;
/** Quality for the upload re-encode: high enough to be visually lossless. */
const UPLOAD_QUALITY = 90;

export const ACCEPTED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export type ImageMime = (typeof ACCEPTED_IMAGE_MIMES)[number];

const EXTENSIONS: Readonly<Record<ImageMime, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// The process handles one upload at a time on a 1 vCPU box; libvips' operation cache
// only helps when the same image is processed repeatedly, which never happens here.
sharp.cache(false);

export function extensionFor(mime: ImageMime): string {
  return EXTENSIONS[mime];
}

export function isImageMime(value: string): value is ImageMime {
  return (ACCEPTED_IMAGE_MIMES as readonly string[]).includes(value);
}

export type ImageRejection = 'unsupported_type' | 'animated' | 'undecodable' | 'too_many_pixels';

/** An upload that is not an acceptable image. The controller maps it to 415 or 413. */
export class ImageRejectedError extends Error {
  constructor(
    readonly reason: ImageRejection,
    message: string,
  ) {
    super(message);
    this.name = 'ImageRejectedError';
  }
}

export interface ProcessedImage {
  data: Buffer;
  mime: ImageMime;
  width: number;
  height: number;
  bytes: number;
  /** Hex sha256 of `data` (the processed bytes), used for dedupe. */
  sha256: string;
}

/** MIME type from magic bytes, or null when it is not one of the accepted image types. */
export async function sniffImageMime(data: Buffer): Promise<ImageMime | null> {
  const type = await fileTypeFromBuffer(data);
  return type && isImageMime(type.mime) ? type.mime : null;
}

function openImage(data: Buffer): sharp.Sharp {
  // failOn 'error' tolerates the minor warnings (e.g. trailing junk) common in camera files.
  return sharp(data, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS });
}

function toRejection(err: unknown): ImageRejectedError {
  const message = err instanceof Error ? err.message : String(err);
  if (/pixel limit/i.test(message)) {
    return new ImageRejectedError(
      'too_many_pixels',
      `The image resolution is too large (max ${MAX_INPUT_PIXELS / 1_000_000} megapixels).`,
    );
  }
  return new ImageRejectedError('undecodable', 'The image could not be decoded.');
}

/**
 * Normalizes an upload:
 * - accepts jpeg, png, webp and static gif by magic bytes (never by name or header);
 * - applies the EXIF orientation, then drops ALL metadata (EXIF, GPS, XMP, ICC -> sRGB);
 * - re-encodes in the same format at high quality, downscaling only above 4096 px;
 * - keeps static GIFs byte for byte; animated GIF/WebP are rejected for now.
 */
export async function processUpload(input: Buffer): Promise<ProcessedImage> {
  const mime = await sniffImageMime(input);
  if (!mime) {
    throw new ImageRejectedError(
      'unsupported_type',
      'Unsupported file type. Upload a JPEG, PNG, WebP or GIF image.',
    );
  }

  let meta: sharp.Metadata;
  try {
    meta = await openImage(input).metadata();
  } catch (err) {
    throw toRejection(err);
  }
  if ((meta.pages ?? 1) > 1) {
    throw new ImageRejectedError(
      'animated',
      mime === 'image/gif'
        ? 'Animated GIFs are not supported yet; GIF animation comes in a later stage.'
        : 'Animated images are not supported yet.',
    );
  }

  if (mime === 'image/gif') {
    // Static GIFs are kept as uploaded: re-encoding would re-quantize the palette.
    // TODO: strip GIF comment / XMP application extensions without re-encoding.
    // TODO: downscale GIFs above MAX_IMAGE_DIMENSION.
    if (!meta.width || !meta.height) throw toRejection(new Error('missing dimensions'));
    return finish(input, mime, meta.width, meta.height);
  }

  try {
    const pipeline = openImage(input)
      .rotate() // auto-orient from EXIF before the metadata is dropped
      .resize({
        width: MAX_IMAGE_DIMENSION,
        height: MAX_IMAGE_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      });
    // sharp writes no metadata unless keepMetadata()/withMetadata() is called.
    const { data, info } = await encode(pipeline, mime, UPLOAD_QUALITY).toBuffer({
      resolveWithObject: true,
    });
    return finish(data, mime, info.width, info.height);
  } catch (err) {
    throw toRejection(err);
  }
}

function finish(data: Buffer, mime: ImageMime, width: number, height: number): ProcessedImage {
  return {
    data,
    mime,
    width,
    height,
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

function encode(image: sharp.Sharp, mime: ImageMime, quality: number): sharp.Sharp {
  switch (mime) {
    case 'image/jpeg':
      return image
        .flatten({ background: '#ffffff' })
        .jpeg({ quality, chromaSubsampling: quality >= 90 ? '4:4:4' : '4:2:0' });
    case 'image/png':
      return image.png();
    case 'image/webp':
      return image.webp({ quality });
    case 'image/gif':
      return image.gif();
  }
}

const isLossy = (mime: ImageMime) => mime === 'image/jpeg' || mime === 'image/webp';

/** Re-encode attempts from best to smallest, for lossy targets. */
const LOSSY_STEPS = [
  { scale: 1, quality: 90 },
  { scale: 1, quality: 80 },
  { scale: 1, quality: 70 },
  { scale: 1, quality: 60 },
  { scale: 0.75, quality: 70 },
  { scale: 0.5, quality: 70 },
  { scale: 0.35, quality: 65 },
  { scale: 0.25, quality: 60 },
] as const;
const LOSSLESS_STEPS = [
  { scale: 1, quality: 100 },
  { scale: 0.75, quality: 100 },
  { scale: 0.5, quality: 100 },
  { scale: 0.35, quality: 100 },
] as const;

export interface PreparedImage {
  buffer: Buffer;
  mime: ImageMime;
}

/**
 * Adapts a stored image to one network's limits, for the provider adapters:
 * - converts to JPEG when the network does not accept the stored type (WebP on LinkedIn);
 * - when the file is above the network's max bytes, re-encodes at lower quality and then
 *   at smaller sizes until it fits. Oversized lossless images (PNG/GIF) switch to JPEG
 *   when the network accepts it, rather than being shrunk.
 * Returns the input untouched when it already fits. Throws when nothing fits.
 */
export async function prepareImageForProvider(
  data: Buffer,
  mime: ImageMime,
  limits: Pick<ProviderLimits, 'allowedMimeTypes' | 'maxImageBytes'>,
): Promise<PreparedImage> {
  const accepted = limits.allowedMimeTypes.includes(mime);
  if (accepted && data.length <= limits.maxImageBytes) return { buffer: data, mime };

  const jpegAccepted = limits.allowedMimeTypes.includes('image/jpeg');
  const candidates: ImageMime[] = [];
  if (accepted) candidates.push(mime);
  if (jpegAccepted && mime !== 'image/jpeg') candidates.push('image/jpeg');
  if (candidates.length === 0) {
    throw new Error(`No accepted image type to convert ${mime} to.`);
  }

  const meta = await openImage(data).metadata();
  const width = meta.width ?? MAX_IMAGE_DIMENSION;

  for (const target of candidates) {
    let steps: ReadonlyArray<{ scale: number; quality: number }> = isLossy(target)
      ? LOSSY_STEPS
      : LOSSLESS_STEPS;
    if (!isLossy(target) && candidates.includes('image/jpeg')) steps = steps.slice(0, 1);

    for (const step of steps) {
      let image = openImage(data);
      if (step.scale < 1)
        image = image.resize({ width: Math.max(1, Math.round(width * step.scale)) });
      const buffer = await encode(image, target, step.quality).toBuffer();
      if (buffer.length <= limits.maxImageBytes) return { buffer, mime: target };
    }
  }
  throw new Error(`Image cannot be reduced below ${limits.maxImageBytes} bytes.`);
}
