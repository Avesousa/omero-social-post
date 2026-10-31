'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/** "214 / 280" with a thin meter. Turns red above the limit and amber when close to it. */
export function CharCounter({
  used,
  limit,
  className,
}: {
  used: number;
  limit: number;
  className?: string;
}) {
  const t = useTranslations('Composer.counter');
  const format = useFormatter();
  const over = used > limit;
  const near = !over && used >= limit * 0.9;
  const ratio = Math.min(used / limit, 1);

  return (
    <span
      data-state={over ? 'over' : near ? 'near' : 'ok'}
      aria-label={
        over ? t('over', { used, limit, excess: used - limit }) : t('count', { used, limit })
      }
      className={cn(
        'inline-flex items-center gap-2 text-xs font-semibold tabular-nums',
        over ? 'text-destructive' : near ? 'text-warning' : 'text-muted-foreground',
        className,
      )}
    >
      <span aria-hidden="true" className="h-1 w-10 overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            'block h-full rounded-full transition-[width]',
            over ? 'bg-destructive' : near ? 'bg-warning' : 'bg-primary',
          )}
          style={{ width: `${ratio * 100}%` }}
        />
      </span>
      <span aria-hidden="true">
        {format.number(used)} / {format.number(limit)}
      </span>
    </span>
  );
}
