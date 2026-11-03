'use client';

import { TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { NetworkIcon } from '@/components/brand/network-icon';
import { type Network, type PostStatus } from '@/lib/design-tokens';

export interface CalendarEventData {
  status: PostStatus;
  preview: string;
  networks: Network[];
  needsAttention: boolean;
  /** Time label in the owner's timezone, e.g. "14:30". */
  time: string;
  /** True for published/failed posts, whose time is when they were published. */
  isPublishedTime: boolean;
}

/** Compact calendar card: tone from the status, network glyphs, time, preview and a warning badge. */
export function EventCard({ data, compact }: { data: CalendarEventData; compact: boolean }) {
  const t = useTranslations('Calendar');
  const ts = useTranslations('Status');
  const label = `${ts(data.status)} ${data.time} ${data.preview}`;

  return (
    <div
      data-status={data.status}
      title={label}
      className="omero-event flex h-full min-w-0 flex-col gap-0.5 px-1.5 py-1 text-[11px] leading-tight"
    >
      <div className="flex min-w-0 items-center gap-1">
        <span className="tone-text font-bold tabular-nums">{data.time}</span>
        <span className="flex items-center gap-0.5 text-muted-foreground">
          {data.networks.map((network) => (
            <NetworkIcon key={network} network={network} className="size-3" />
          ))}
        </span>
        {data.needsAttention ? (
          <span
            role="img"
            aria-label={t('needsAttention')}
            className="ml-auto inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-warning text-white"
          >
            <TriangleAlertIcon className="size-2.5" />
          </span>
        ) : null}
      </div>
      <p className={compact ? 'truncate font-medium' : 'line-clamp-2 font-medium'}>
        {data.preview || t('noText')}
      </p>
      {!compact && data.isPublishedTime ? (
        <p className="tone-text truncate text-[10px] font-semibold">{ts(data.status)}</p>
      ) : null}
    </div>
  );
}
