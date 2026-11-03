'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { type PostStatus } from '@/lib/design-tokens';
import { cn } from '@/lib/utils';

/** Colored dot for a post or delivery status. Pulses while publishing. */
export function StatusDot({ status, className }: { status: PostStatus; className?: string }) {
  return (
    <span
      data-status={status}
      aria-hidden="true"
      className={cn(
        'tone-bg inline-block size-2 shrink-0 rounded-full',
        status === 'publishing' && 'animate-omero-pulse',
        className,
      )}
    />
  );
}

/** Translated status pill, colored from the `--status-*` tokens. */
export function StatusBadge({ status, className }: { status: PostStatus; className?: string }) {
  const t = useTranslations('Status');
  return (
    <Badge variant="tone" data-status={status} className={className}>
      <StatusDot status={status} />
      {t(status)}
    </Badge>
  );
}
