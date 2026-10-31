'use client';

import { useTranslations } from 'next-intl';
import { estimatePasswordStrength } from '@/lib/password-strength';
import { cn } from '@/lib/utils';

const SEGMENT_TONE = ['bg-danger', 'bg-warning', 'bg-info', 'bg-success'] as const;

/** Four-segment strength meter with a text label, announced politely as the user types. */
export function PasswordStrengthMeter({ password }: { password: string }) {
  const t = useTranslations('Auth.strength');
  const { level, score } = estimatePasswordStrength(password);

  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      <div className="flex gap-1.5" aria-hidden="true">
        {[1, 2, 3, 4].map((segment) => (
          <span
            key={segment}
            className={cn(
              'h-1.5 flex-1 rounded-full bg-muted transition-colors',
              segment <= score && SEGMENT_TONE[score - 1],
            )}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {level === 'empty' ? t('empty') : t('label', { level: t(level) })}
      </p>
    </div>
  );
}
