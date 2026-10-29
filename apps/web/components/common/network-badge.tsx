'use client';

import { useTranslations } from 'next-intl';
import { NetworkIcon } from '@/components/brand/network-icon';
import { type Network } from '@/lib/design-tokens';
import { cn } from '@/lib/utils';

/** Round network avatar in the network's accent color. */
export function NetworkAvatar({
  network,
  className,
  label,
}: {
  network: Network;
  className?: string;
  /** Accessible name; omit when the network name is already visible next to it. */
  label?: string;
}) {
  return (
    <span
      data-network={network}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        'tone-solid inline-flex size-6 shrink-0 items-center justify-center rounded-full',
        className,
      )}
    >
      <NetworkIcon network={network} className="size-3" />
    </span>
  );
}

/** Network chip: accent avatar plus the network name on a soft tinted pill. */
export function NetworkBadge({ network, className }: { network: Network; className?: string }) {
  const t = useTranslations('Network');
  return (
    <span
      data-network={network}
      className={cn(
        'tone-soft inline-flex h-7 items-center gap-1.5 rounded-full pr-3 pl-0.5 text-xs font-semibold',
        className,
      )}
    >
      <NetworkAvatar network={network} />
      {t(network)}
    </span>
  );
}
