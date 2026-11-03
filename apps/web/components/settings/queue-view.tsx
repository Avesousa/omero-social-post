'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClockIcon, PlusIcon, SparklesIcon, XIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  getQueueSlotsControllerListQueryKey,
  getQueueSlotsControllerNextQueryKey,
  isApiError,
  useQueueSlotsControllerList,
  useQueueSlotsControllerNext,
  useQueueSlotsControllerReplace,
  type QueueSlotsDtoOutputItem,
} from '@omero/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { formatInstant, useOwnerSettings } from './owner-settings';

type Slot = QueueSlotsDtoOutputItem;

/** Monday first; `weekday` follows JS `getDay()` (0 = Sunday). */
const WEEK_ORDER = [
  { weekday: 1, key: 'monday' },
  { weekday: 2, key: 'tuesday' },
  { weekday: 3, key: 'wednesday' },
  { weekday: 4, key: 'thursday' },
  { weekday: 5, key: 'friday' },
  { weekday: 6, key: 'saturday' },
  { weekday: 0, key: 'sunday' },
] as const;

const PRESET: Slot[] = [1, 2, 3, 4, 5].flatMap((weekday) =>
  ['09:00', '18:00'].map((localTime) => ({ weekday, localTime, enabled: true })),
);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const sortSlots = (slots: readonly Slot[]) =>
  [...slots].sort((a, b) => a.weekday - b.weekday || a.localTime.localeCompare(b.localTime));

const serialize = (slots: readonly Slot[]) => JSON.stringify(sortSlots(slots));

function AddTime({
  dayName,
  existing,
  onAdd,
}: {
  dayName: string;
  existing: readonly string[];
  onAdd: (time: string) => void;
}) {
  const t = useTranslations('Settings.queue');
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('12:00');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!TIME_RE.test(value)) return setError(t('invalidTime'));
    if (existing.includes(value)) return setError(t('duplicate', { time: value }));
    onAdd(value);
    setOpen(false);
    setError(null);
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="rounded-full"
        aria-label={t('addTimeAria', { day: dayName })}
        onClick={() => setOpen(true)}
      >
        <PlusIcon aria-hidden="true" />
        {t('addTime')}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Input
          type="time"
          value={value}
          aria-label={t('timeLabel')}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
            if (e.key === 'Escape') setOpen(false);
          }}
          className="h-8 w-28"
          autoFocus
        />
        <Button size="sm" onClick={submit}>
          {t('confirmAdd')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t('cancelAdd')}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function NextSlotPreview({ timezone, hasSlots }: { timezone: string; hasSlots: boolean }) {
  const t = useTranslations('Settings.queue');
  const locale = useLocale();
  const next = useQueueSlotsControllerNext();

  let body: string;
  if (next.isError) body = t('preview.error');
  else if (next.isPending) body = '…';
  else if (next.data.scheduledAt) {
    body = formatInstant(next.data.scheduledAt, locale, timezone, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
  } else body = hasSlots ? t('preview.none') : t('preview.noSlots');

  return (
    <div className="flex items-start gap-3 rounded-2xl bg-accent p-4 text-accent-foreground">
      <CalendarClockIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
      <div>
        <p className="text-xs font-semibold tracking-wide uppercase">{t('preview.label')}</p>
        <p data-testid="next-slot" className="text-lg font-semibold first-letter:uppercase">
          {body}
        </p>
        <p className="text-xs opacity-80">{t('preview.savedOnly')}</p>
      </div>
    </div>
  );
}

export function QueueView() {
  const t = useTranslations('Settings.queue');
  const queryClient = useQueryClient();
  const { timezone } = useOwnerSettings();
  const list = useQueueSlotsControllerList();
  const replace = useQueueSlotsControllerReplace();
  // `null` means "no local edits": the draft mirrors the server until the first change.
  const [draft, setDraft] = useState<Slot[] | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const saved = list.data;
  const slots = useMemo(() => draft ?? saved ?? [], [draft, saved]);
  const dirty = draft !== null && saved !== undefined && serialize(draft) !== serialize(saved);

  const byDay = useMemo(() => {
    const map = new Map<number, Slot[]>();
    for (const slot of sortSlots(slots))
      map.set(slot.weekday, [...(map.get(slot.weekday) ?? []), slot]);
    return map;
  }, [slots]);

  function edit(next: Slot[]) {
    setProblems([]);
    setDraft(next);
  }

  function save() {
    replace.mutate(
      { data: sortSlots(slots) },
      {
        onSuccess: async (result) => {
          queryClient.setQueryData(getQueueSlotsControllerListQueryKey(), result);
          await queryClient.invalidateQueries({ queryKey: getQueueSlotsControllerNextQueryKey() });
          setDraft(null);
          setProblems([]);
          toast.success(t('saved'));
        },
        onError: (error) => {
          const messages = isApiError(error) ? error.errors.map((e) => e.message) : [];
          setProblems(messages.length > 0 ? messages : [t('saveError')]);
        },
      },
    );
  }

  const dayName = (key: (typeof WEEK_ORDER)[number]['key']) => t(`weekdays.${key}`);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-[-0.03em]">{t('title')}</h2>
          <p className="mt-1 max-w-[62ch] text-muted-foreground">{t('description')}</p>
        </div>
        <Button variant="outline" onClick={() => edit(PRESET)} title={t('presetHint')}>
          <SparklesIcon aria-hidden="true" />
          {t('preset')}
        </Button>
      </div>

      <NextSlotPreview timezone={timezone} hasSlots={(saved ?? []).some((s) => s.enabled)} />

      <p className="text-sm text-muted-foreground">
        {t('timezone.label')}: <strong className="text-foreground">{timezone}</strong>
        {' · '}
        <Link href="/settings/general" className="font-semibold text-primary hover:underline">
          {t('timezone.change')}
        </Link>
      </p>

      {list.isPending ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : list.isError ? (
        <p className="text-sm text-destructive">{t('loadError')}</p>
      ) : (
        <>
          {slots.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-muted/40 p-5">
              <p className="font-semibold">{t('empty.title')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('empty.body')}</p>
            </div>
          ) : null}

          <ul className="divide-y rounded-2xl border bg-card shadow-sm">
            {WEEK_ORDER.map(({ weekday, key }) => {
              const day = byDay.get(weekday) ?? [];
              return (
                <li
                  key={weekday}
                  data-testid={`day-${weekday}`}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start"
                >
                  <div className="w-32 shrink-0">
                    <h3 className="text-sm font-semibold">{dayName(key)}</h3>
                    <p className="text-xs text-muted-foreground">
                      {t('slotCount', { count: day.length })}
                    </p>
                  </div>
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    {day.map((slot) => (
                      <span
                        key={slot.localTime}
                        className={cn(
                          'inline-flex h-8 items-center gap-2 rounded-full border bg-background pr-1 pl-3 text-sm font-semibold tabular-nums',
                          !slot.enabled && 'text-muted-foreground line-through opacity-70',
                        )}
                      >
                        {slot.localTime}
                        <Switch
                          className="h-4 w-7 [&>span]:size-3"
                          checked={slot.enabled}
                          aria-label={t('enableSlot', { day: dayName(key), time: slot.localTime })}
                          onCheckedChange={(enabled) =>
                            edit(
                              slots.map((s) =>
                                s.weekday === weekday && s.localTime === slot.localTime
                                  ? { ...s, enabled }
                                  : s,
                              ),
                            )
                          }
                        />
                        <button
                          type="button"
                          aria-label={t('removeSlot', { day: dayName(key), time: slot.localTime })}
                          className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          onClick={() =>
                            edit(
                              slots.filter(
                                (s) => !(s.weekday === weekday && s.localTime === slot.localTime),
                              ),
                            )
                          }
                        >
                          <XIcon className="size-3.5" aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                    <AddTime
                      dayName={dayName(key)}
                      existing={day.map((s) => s.localTime)}
                      onAdd={(time) =>
                        edit([...slots, { weekday, localTime: time, enabled: true }])
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          {problems.length > 0 ? (
            <div
              role="alert"
              className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm"
            >
              <p className="font-semibold text-destructive">{t('errorsTitle')}</p>
              <ul className="mt-1 list-disc pl-5">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="sticky bottom-4 flex flex-wrap items-center justify-end gap-3 rounded-xl border bg-card/95 p-3 shadow-md backdrop-blur">
            {dirty ? (
              <span className="mr-auto text-sm text-muted-foreground">{t('unsaved')}</span>
            ) : null}
            <Button
              variant="ghost"
              disabled={!dirty || replace.isPending}
              onClick={() => edit(saved ?? [])}
            >
              {t('discard')}
            </Button>
            <Button disabled={!dirty || replace.isPending} onClick={save}>
              {replace.isPending ? t('saving') : t('save')}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
