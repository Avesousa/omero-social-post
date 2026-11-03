'use client';

import { useRef, useState } from 'react';
import { ImagePlusIcon, LoaderCircleIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PROVIDER_LIMITS, type ProviderId } from '@omero/shared';
import { NetworkAvatar } from '@/components/common/network-badge';
import { cn } from '@/lib/utils';
import type { MediaRef } from './state';

/** Types the media endpoint accepts at all (per-network limits are checked on top of this). */
export const UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

const MIME_LABEL: Record<string, string> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/gif': 'GIF',
};

/**
 * Image area with thumbnails, an "add" tile and drag & drop.
 * It only reports files; the composer uploads them and attaches the result.
 */
export function ImageDropzone({
  mediaIds,
  media,
  uploading,
  onFiles,
  onRemove,
  readOnly = false,
  compact = false,
  invalidIds,
  className,
}: {
  mediaIds: readonly string[];
  media: Readonly<Record<string, MediaRef>>;
  uploading: number;
  onFiles: (files: File[]) => void;
  onRemove: (mediaId: string) => void;
  readOnly?: boolean;
  compact?: boolean;
  /** Images that break a network limit; drawn with a red outline. */
  invalidIds?: ReadonlySet<string>;
  className?: string;
}) {
  const t = useTranslations('Composer.images');
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function takeFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    onFiles(Array.from(list));
  }

  const hasContent = mediaIds.length > 0 || uploading > 0;

  return (
    <div
      onDragEnter={(event) => {
        if (readOnly || !event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (readOnly || !event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (readOnly) return;
        event.preventDefault();
        setDragging(false);
        takeFiles(event.dataTransfer.files);
      }}
      data-dragging={dragging || undefined}
      className={cn(
        'rounded-lg border border-dashed border-input transition-colors',
        dragging ? 'border-primary bg-primary/5' : 'bg-muted/30',
        compact ? 'p-2' : 'p-3',
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        multiple
        hidden
        data-testid="image-input"
        onChange={(event) => {
          takeFiles(event.target.files);
          // Allow picking the same file again after removing it.
          event.target.value = '';
        }}
      />

      {hasContent || !readOnly ? (
        <ul className="flex flex-wrap items-center gap-2">
          {mediaIds.map((id) => {
            const ref = media[id];
            const invalid = invalidIds?.has(id) ?? false;
            return (
              <li
                key={id}
                className={cn(
                  'group relative size-[72px] overflow-hidden rounded-md border bg-card',
                  invalid && 'border-destructive ring-2 ring-destructive/30',
                )}
              >
                {ref ? (
                  // Authenticated same-origin media; next/image's optimizer cannot send the session cookie.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ref.url}
                    alt={t('thumbAlt')}
                    width={72}
                    height={72}
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="size-full bg-muted" />
                )}
                {readOnly ? null : (
                  <button
                    type="button"
                    onClick={() => onRemove(id)}
                    aria-label={t('remove')}
                    className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-espresso/80 text-white opacity-0 transition-opacity outline-none group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:ring-2 focus-visible:ring-white [@media(hover:none)]:opacity-100"
                  >
                    <XIcon className="size-3" />
                  </button>
                )}
              </li>
            );
          })}

          {Array.from({ length: uploading }, (_, index) => (
            <li
              key={`uploading-${index}`}
              role="status"
              aria-label={t('uploading')}
              className="flex size-[72px] items-center justify-center rounded-md border bg-card text-muted-foreground"
            >
              <LoaderCircleIcon className="size-5 animate-spin" />
            </li>
          ))}

          {readOnly ? null : (
            <li>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-md border border-dashed border-input bg-card text-sm font-semibold text-muted-foreground transition-colors outline-none hover:border-primary hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  hasContent
                    ? 'size-[72px] flex-col gap-1 text-xs'
                    : compact
                      ? 'h-10 px-3'
                      : 'h-[72px] px-5',
                )}
              >
                <ImagePlusIcon className="size-5" />
                {hasContent || compact ? t('addShort') : t('dropHint')}
              </button>
            </li>
          )}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      )}
    </div>
  );
}

function formatMegabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/** Per-network image limits, shown next to every image area. */
export function ImageLimits({ providers }: { providers: readonly ProviderId[] }) {
  const t = useTranslations('Composer.images');
  const tn = useTranslations('Network');
  if (providers.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      {providers.map((provider) => {
        const limits = PROVIDER_LIMITS[provider];
        const types = limits.allowedMimeTypes.map((mime) => MIME_LABEL[mime] ?? mime).join(', ');
        return (
          <li key={provider} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <NetworkAvatar network={provider} className="size-4" />
            <span className="font-semibold text-foreground">{tn(provider)}</span>
            <span>
              {t('limitLine', {
                count: limits.maxImagesPerItem,
                size: formatMegabytes(limits.maxImageBytes),
                types,
              })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
