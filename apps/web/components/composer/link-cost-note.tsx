'use client';

import { LinkIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/** Small heads-up shown on X items that contain a URL: posts with links cost more on the X API. */
export function LinkCostNote({ className }: { className?: string }) {
  const t = useTranslations('Composer');
  return (
    <p
      className={cn(
        'inline-flex items-start gap-1.5 rounded-md bg-info/10 px-2 py-1 text-xs font-medium text-info',
        className,
      )}
    >
      <LinkIcon className="mt-px size-3.5 shrink-0" />
      {t('linkCost')}
    </p>
  );
}
