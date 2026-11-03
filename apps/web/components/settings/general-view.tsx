'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckIcon, GlobeIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  getQueueSlotsControllerNextQueryKey,
  getSettingsControllerGetQueryKey,
  useSettingsControllerUpdate,
  type SettingsDtoOutput,
} from '@omero/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { browserTimeZone, formatInstant, useOwnerSettings } from './owner-settings';

/** IANA zones the runtime knows; UTC is added because some engines omit it. */
function allTimeZones(): string[] {
  try {
    const zones = Intl.supportedValuesOf('timeZone');
    return zones.includes('UTC') ? zones : ['UTC', ...zones];
  } catch {
    return ['UTC'];
  }
}

function TimezonePicker({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  const t = useTranslations('Settings.general.timezone');
  const [query, setQuery] = useState('');
  const zones = useMemo(() => allTimeZones(), []);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, '_');
    return (q ? zones.filter((z) => z.toLowerCase().includes(q)) : zones).slice(0, 80);
  }, [zones, query]);

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('search')}
        aria-label={t('search')}
      />
      <ul
        role="listbox"
        aria-label={t('listLabel')}
        className="max-h-56 overflow-y-auto rounded-lg border bg-card p-1"
      >
        {matches.length === 0 ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">{t('noResults')}</li>
        ) : (
          matches.map((zone) => (
            <li key={zone} role="option" aria-selected={zone === value}>
              <button
                type="button"
                onClick={() => onChange(zone)}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  zone === value && 'bg-accent font-semibold text-accent-foreground',
                )}
              >
                {zone}
                {zone === value ? <CheckIcon className="size-4" aria-hidden="true" /> : null}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function GeneralForm({ settings }: { settings: SettingsDtoOutput }) {
  const t = useTranslations('Settings.general');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const update = useSettingsControllerUpdate();
  const [timezone, setTimezone] = useState(settings.timezone);
  const [hours, setHours] = useState(String(Math.round(settings.missedGraceMinutes / 60)));
  const browserTz = browserTimeZone();

  const hoursNumber = Number(hours);
  const hoursValid = Number.isInteger(hoursNumber) && hoursNumber >= 1 && hoursNumber <= 48;
  const minutes = hoursNumber * 60;
  const dirty =
    timezone !== settings.timezone || (hoursValid && minutes !== settings.missedGraceMinutes);

  function save() {
    update.mutate(
      { data: { timezone, missedGraceMinutes: minutes } },
      {
        onSuccess: async (result) => {
          queryClient.setQueryData(getSettingsControllerGetQueryKey(), result);
          await queryClient.invalidateQueries({ queryKey: getQueueSlotsControllerNextQueryKey() });
          toast.success(t('saved'));
        },
        onError: () => toast.error(t('saveError')),
      },
    );
  }

  let nowThere: string | null = null;
  try {
    nowThere = formatInstant(new Date().toISOString(), locale, timezone, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    nowThere = null;
  }

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold">{t('timezone.label')}</h3>
        <p className="text-sm text-muted-foreground">{t('timezone.help')}</p>
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-accent p-3 text-accent-foreground">
          <GlobeIcon className="size-5 text-primary" aria-hidden="true" />
          <div className="mr-auto">
            <p data-testid="selected-timezone" className="font-semibold">
              {timezone}
            </p>
            {nowThere ? <p className="text-xs">{t('timezone.nowIn', { time: nowThere })}</p> : null}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={timezone === browserTz}
            onClick={() => setTimezone(browserTz)}
          >
            {t('timezone.useBrowser')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('timezone.browserIs', { timezone: browserTz })}
        </p>
        <TimezonePicker value={timezone} onChange={setTimezone} />
      </section>

      <section className="flex flex-col gap-3">
        <label htmlFor="grace-hours" className="text-lg font-semibold">
          {t('grace.label')}
        </label>
        <p className="text-sm text-muted-foreground">{t('grace.help')}</p>
        <div className="flex items-center gap-2">
          <Input
            id="grace-hours"
            type="number"
            min={1}
            max={48}
            step={1}
            inputMode="numeric"
            value={hours}
            aria-invalid={!hoursValid || undefined}
            onChange={(e) => setHours(e.target.value)}
            className="w-24"
          />
          <span className="text-sm text-muted-foreground">{t('grace.unit')}</span>
        </div>
        {!hoursValid ? (
          <p role="alert" className="text-sm text-destructive">
            {t('grace.invalid')}
          </p>
        ) : null}
      </section>

      <div>
        <Button disabled={!dirty || !hoursValid || update.isPending} onClick={save}>
          {update.isPending ? t('saving') : t('save')}
        </Button>
      </div>
    </div>
  );
}

export function GeneralView() {
  const t = useTranslations('Settings.general');
  const { settings, isPending, isError } = useOwnerSettings();

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold tracking-[-0.03em]">{t('title')}</h2>
        <p className="mt-1 max-w-[62ch] text-muted-foreground">{t('description')}</p>
      </div>
      {isPending ? (
        <Skeleton className="h-96 max-w-2xl rounded-2xl" />
      ) : isError || !settings ? (
        <p className="text-sm text-destructive">{t('loadError')}</p>
      ) : (
        <GeneralForm settings={settings} />
      )}
    </section>
  );
}
