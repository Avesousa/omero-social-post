'use client';

import Link from 'next/link';
import { CheckIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { NetworkIcon } from '@/components/brand/network-icon';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { ComposerChannel } from './use-channels';

/** Multi-select of connected accounts, drawn as toggle cards in each network's color. */
export function ChannelPicker({
  channels,
  selected,
  onToggle,
  isPending,
  isError,
  readOnly = false,
  invalid = false,
}: {
  channels: readonly ComposerChannel[];
  selected: readonly string[];
  onToggle: (channelId: string) => void;
  isPending: boolean;
  isError: boolean;
  readOnly?: boolean;
  invalid?: boolean;
}) {
  const t = useTranslations('Composer.channels');

  if (isPending) {
    return (
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-16 w-56 rounded-xl" />
        <Skeleton className="h-16 w-56 rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-destructive">{t('loadError')}</p>;
  }

  if (channels.length === 0) {
    return (
      <div className="flex flex-col items-start gap-1 rounded-xl border border-dashed bg-muted/40 p-4">
        <p className="text-sm font-semibold">{t('emptyTitle')}</p>
        <p className="text-sm text-muted-foreground">{t('emptyBody')}</p>
        <Link href="/settings" className="text-sm font-semibold text-primary hover:underline">
          {t('emptyCta')}
        </Link>
      </div>
    );
  }

  return (
    <ul
      role="group"
      aria-label={t('label')}
      aria-invalid={invalid || undefined}
      className="flex flex-wrap gap-3"
    >
      {channels.map((channel) => {
        const isSelected = selected.includes(channel.id);
        const disconnected = channel.status === 'disconnected';
        const needsReconnect = channel.status === 'needs_reconnect';
        const disabled = readOnly || (disconnected && !isSelected);

        return (
          <li key={channel.id}>
            <button
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              data-network={channel.provider}
              data-selected={isSelected || undefined}
              disabled={disabled}
              onClick={() => onToggle(channel.id)}
              className={cn(
                'group relative flex min-w-52 items-center gap-3 rounded-xl border bg-card p-3 pr-10 text-left shadow-xs transition-[border-color,box-shadow,background-color] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-55',
                isSelected
                  ? 'tone-border border-[var(--tone)] bg-[color-mix(in_oklab,var(--tone)_7%,var(--card))] shadow-sm'
                  : 'hover:border-input hover:shadow-sm',
                invalid && !isSelected && 'border-destructive/50',
              )}
            >
              <span className="tone-solid flex size-10 shrink-0 items-center justify-center rounded-full">
                <NetworkIcon network={channel.provider} className="size-[18px]" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold">
                  {channel.displayName ?? channel.handle}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {channel.handle.startsWith('@') ? channel.handle : `@${channel.handle}`}
                </span>
                {needsReconnect || disconnected ? (
                  <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-warning">
                    <TriangleAlertIcon className="size-3" />
                    {needsReconnect ? t('needsReconnect') : t('disconnected')}
                  </span>
                ) : null}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-1/2 right-3 flex size-5 -translate-y-1/2 items-center justify-center rounded-full border transition-colors',
                  isSelected ? 'tone-solid border-transparent' : 'border-input bg-card',
                )}
              >
                {isSelected ? <CheckIcon className="size-3.5" /> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
