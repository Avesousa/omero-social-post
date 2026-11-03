'use client';

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type CalendarViewName = 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth';

const VIEWS: readonly CalendarViewName[] = ['timeGridDay', 'timeGridWeek', 'dayGridMonth'];

/** Custom toolbar: prev / today / next, the period title and a day / week / month switch. */
export function CalendarToolbar({
  title,
  view,
  onPrev,
  onNext,
  onToday,
  onView,
}: {
  title: string;
  view: CalendarViewName;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onView: (view: CalendarViewName) => void;
}) {
  const t = useTranslations('Calendar');

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="icon"
          className="rounded-full"
          onClick={onPrev}
          aria-label={t('prev')}
        >
          <ChevronLeftIcon />
        </Button>
        <Button variant="outline" className="rounded-full" onClick={onToday}>
          {t('today')}
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="rounded-full"
          onClick={onNext}
          aria-label={t('next')}
        >
          <ChevronRightIcon />
        </Button>
      </div>
      <h2 className="min-w-0 flex-1 text-lg font-bold tracking-[-0.02em] first-letter:uppercase order-last basis-full sm:order-none sm:basis-auto sm:text-xl">
        {title}
      </h2>
      <div
        role="group"
        aria-label={t('viewLabel')}
        className="inline-flex h-9 items-center rounded-full border border-input bg-card p-0.5 shadow-xs dark:bg-input/20"
      >
        {VIEWS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === view}
            onClick={() => onView(option)}
            className={cn(
              'h-full rounded-full px-3 text-xs font-bold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              option === 'timeGridDay' && 'sm:hidden',
              option === view
                ? 'bg-espresso text-sidebar-foreground dark:bg-primary dark:text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`views.${option}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
