'use client';

import { useTranslations } from 'next-intl';
import { NetworkAvatar, NetworkBadge } from '@/components/common/network-badge';
import { Badge } from '@/components/ui/badge';
import { ACTIVE_NETWORKS, NETWORKS } from '@/lib/design-tokens';
import { cn } from '@/lib/utils';
import { Section } from './section';

export function NetworksSection() {
  const t = useTranslations('DesignSystem.networks');
  const tn = useTranslations('Network');

  return (
    <Section id="networks" title={t('title')} description={t('description')}>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {NETWORKS.map((network) => {
          const active = ACTIVE_NETWORKS.includes(network);
          return (
            <li
              key={network}
              data-network={network}
              className={cn(
                'relative flex flex-col gap-4 overflow-hidden rounded-xl border border-border/70 bg-card p-5 shadow-sm',
                !active && 'border-dashed bg-card/60 shadow-none',
              )}
            >
              <span aria-hidden="true" className="tone-bg absolute inset-x-0 top-0 h-1" />
              <div className="flex items-center gap-3">
                <NetworkAvatar
                  network={network}
                  className={cn('size-10 [&_svg]:size-[18px]', !active && 'opacity-60')}
                />
                <p className="font-display text-lg font-semibold">{tn(network)}</p>
              </div>
              <div className="flex items-center justify-between gap-2">
                <NetworkBadge network={network} className={cn(!active && 'opacity-60')} />
                {active ? (
                  <Badge variant="tone" data-status="published">
                    {t('available')}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    {t('later')}
                  </Badge>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
