'use client';

import { CalendarDaysIcon, ClockIcon, SquarePenIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { NetworkAvatar, NetworkBadge } from '@/components/common/network-badge';
import { StatusBadge } from '@/components/common/status-badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

const USED = 214;
const LIMIT = 280;

/** Opening block: the product promise next to a live-looking post with its per-network deliveries. */
export function Hero() {
  const t = useTranslations('DesignSystem.hero');
  const tp = useTranslations('DesignSystem.samplePost');
  const tc = useTranslations('Common');

  const comingSoon = () => toast(tc('comingSoon'));

  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-md">
      <div className="grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div className="flex flex-col justify-center gap-6 p-7 sm:p-10 lg:p-12">
          <h2 className="max-w-[17ch] text-[clamp(2rem,4.2vw,3.3rem)] leading-[1.02] font-bold tracking-[-0.04em]">
            {t('title')}
          </h2>
          <p className="max-w-[52ch] text-base leading-relaxed text-muted-foreground">
            {t('body')}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" onClick={comingSoon}>
              <SquarePenIcon />
              {t('primaryCta')}
            </Button>
            <Button size="lg" variant="outline" onClick={comingSoon}>
              <CalendarDaysIcon />
              {t('secondaryCta')}
            </Button>
          </div>
        </div>

        <div className="relative flex items-center justify-center border-t border-border/70 bg-muted/60 bg-[radial-gradient(var(--input)_1px,transparent_1px)] [background-size:18px_18px] p-5 sm:p-10 lg:border-t-0 lg:border-l">
          <article className="w-full max-w-[400px] rounded-xl border border-border/70 bg-card p-5 shadow-lg">
            <header className="flex items-start gap-3">
              <Avatar className="size-10">
                <AvatarFallback className="bg-crema text-sm font-bold text-espresso">
                  OD
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{tp('author')}</p>
                <p className="truncate text-xs text-muted-foreground">{tp('handle')}</p>
              </div>
              <StatusBadge status="publishing" />
            </header>

            <p className="mt-4 text-[15px] leading-relaxed">{tp('body')}</p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <NetworkBadge network="x" />
              <NetworkBadge network="linkedin" />
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <ClockIcon className="size-3.5" />
                {tp('when')}
              </span>
            </div>

            <Separator className="my-4" />

            <p className="mb-2 text-xs font-semibold text-muted-foreground">{tp('deliveries')}</p>
            <ul className="flex flex-col gap-2">
              <li className="flex items-center gap-2.5 rounded-lg bg-muted/70 px-2.5 py-2">
                <NetworkAvatar network="x" label="X" />
                <span className="flex-1 text-sm font-medium">{tp('thread', { count: 3 })}</span>
                <StatusBadge status="published" />
              </li>
              <li className="flex items-center gap-2.5 rounded-lg bg-muted/70 px-2.5 py-2">
                <NetworkAvatar network="linkedin" label="LinkedIn" />
                <span className="flex-1 text-sm font-medium">{tp('single')}</span>
                <StatusBadge status="publishing" />
              </li>
            </ul>

            <div className="mt-4">
              <div
                className="h-1.5 overflow-hidden rounded-full bg-muted"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={LIMIT}
                aria-valuenow={USED}
                aria-label={tp('characters', { used: USED, limit: LIMIT })}
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${(USED / LIMIT) * 100}%` }}
                />
              </div>
              <p className="mt-1.5 text-right text-xs text-muted-foreground tabular-nums">
                {tp('characters', { used: USED, limit: LIMIT })}
              </p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
