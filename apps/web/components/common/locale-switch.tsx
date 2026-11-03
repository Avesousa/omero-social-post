'use client';

import { useOptimistic, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { setLocale } from '@/i18n/actions';
import { locales, type Locale } from '@/i18n/config';
import { cn } from '@/lib/utils';

/**
 * Segmented ES / EN switch. Stores the choice in the locale cookie through a
 * server action, then refreshes the route so server components re-render.
 */
export function LocaleSwitch({ className }: { className?: string }) {
  const t = useTranslations('Locale');
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Moves the pill immediately while the cookie is saved and the route re-renders.
  const [current, setOptimisticLocale] = useOptimistic(locale);

  function choose(next: Locale) {
    if (next === current) return;
    startTransition(async () => {
      setOptimisticLocale(next);
      await setLocale(next);
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label={t('label')}
      aria-busy={isPending}
      className={cn(
        'inline-flex h-9 items-center rounded-full border border-input bg-card p-0.5 shadow-xs dark:bg-input/20',
        isPending && 'opacity-70',
        className,
      )}
    >
      {locales.map((option) => {
        const active = option === current;
        return (
          <button
            key={option}
            type="button"
            lang={option}
            aria-pressed={active}
            title={t(option)}
            onClick={() => choose(option)}
            className={cn(
              'h-full rounded-full px-3 text-xs font-bold uppercase transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              active
                ? 'bg-espresso text-sidebar-foreground dark:bg-primary dark:text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
