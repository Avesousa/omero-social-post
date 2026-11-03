'use client';

import { CalendarClockIcon } from 'lucide-react';
import { DateTime } from 'luxon';
import { useLocale, useTranslations } from 'next-intl';
import { useSettingsControllerGet } from '@omero/api-client';
import { isValidZone } from './time';

/** Notice shown above the composer when it was opened from a calendar slot (`?scheduledAt=`). */
export function ScheduledHint({ scheduledAt }: { scheduledAt: string }) {
  const t = useTranslations('Calendar');
  const locale = useLocale();
  const { data } = useSettingsControllerGet();
  const zone = isValidZone(data?.timezone) ? data.timezone : undefined;
  const dt = DateTime.fromISO(scheduledAt, { zone: zone ?? 'utc' }).setLocale(locale);
  if (!dt.isValid) return null;

  return (
    <p
      role="status"
      className="mb-4 inline-flex items-center gap-2 rounded-full bg-accent px-3.5 py-1.5 text-sm font-semibold text-accent-foreground"
    >
      <CalendarClockIcon className="size-4" />
      {t('intendedTime', { when: dt.toFormat('cccc d LLLL, HH:mm') })}
    </p>
  );
}
