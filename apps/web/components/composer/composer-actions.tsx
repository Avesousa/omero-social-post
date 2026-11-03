'use client';

import {
  CalendarClockIcon,
  ListPlusIcon,
  LoaderCircleIcon,
  SaveIcon,
  SendIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Action buttons of the composer.
 *
 * T030 plug-in point: replace the three disabled buttons with the real schedule / queue /
 * publish-now actions (they need the saved post's id and `version`, so they run after
 * `onSaveDraft` succeeds or on an already saved post).
 */
export function ComposerActions({
  canSave,
  saving,
  onSaveDraft,
}: {
  canSave: boolean;
  saving: boolean;
  onSaveDraft: () => void;
}) {
  const t = useTranslations('Composer.actions');

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" size="lg" disabled={!canSave} onClick={onSaveDraft} className="w-full">
        {saving ? <LoaderCircleIcon className="animate-spin" /> : <SaveIcon />}
        {saving ? t('saving') : t('saveDraft')}
      </Button>

      <ComingSoonButton icon={<CalendarClockIcon />} label={t('schedule')} hint={t('soon')} />
      <ComingSoonButton icon={<ListPlusIcon />} label={t('queue')} hint={t('soon')} />
      <ComingSoonButton icon={<SendIcon />} label={t('publishNow')} hint={t('soon')} />
    </div>
  );
}

/** A disabled button whose tooltip still opens (disabled buttons swallow pointer events, so a wrapper holds focus). */
function ComingSoonButton({
  icon,
  label,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="block rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Button
            type="button"
            variant="outline"
            disabled
            className="w-full"
            aria-label={`${label}, ${hint}`}
          >
            {icon}
            {label}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}
