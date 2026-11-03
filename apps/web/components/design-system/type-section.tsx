'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { CardHeading, Section } from './section';

const radii = [
  { name: 'sm', className: 'rounded-sm', px: 6 },
  { name: 'md', className: 'rounded-md', px: 10 },
  { name: 'lg', className: 'rounded-lg', px: 14 },
  { name: 'xl', className: 'rounded-xl', px: 20 },
  { name: '2xl', className: 'rounded-2xl', px: 28 },
  { name: 'full', className: 'rounded-full', px: null },
];

const shadows = [
  { name: 'xs', className: 'shadow-xs' },
  { name: 'sm', className: 'shadow-sm' },
  { name: 'md', className: 'shadow-md' },
  { name: 'lg', className: 'shadow-lg' },
];

export function TypeSection() {
  const t = useTranslations('DesignSystem.type');

  return (
    <Section id="type" title={t('title')} description={t('description')}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="space-y-8">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">
                {t('display')}, Bricolage Grotesque
              </p>
              <p className="mt-2 font-display text-[clamp(2.4rem,5vw,3.6rem)] leading-none font-bold tracking-[-0.04em]">
                {t('sampleDisplay')}
              </p>
              <div className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-1 font-display tracking-[-0.02em]">
                <span className="text-3xl font-semibold">Aa</span>
                <span className="text-2xl font-semibold">Aa</span>
                <span className="text-xl font-semibold">Aa</span>
                <span className="text-lg font-medium">Aa</span>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground">{t('body')}, Figtree</p>
              <p className="mt-2 max-w-[60ch] text-base leading-relaxed">{t('sampleBody')}</p>
              <p className="mt-2 max-w-[60ch] text-sm text-muted-foreground">{t('sampleBody')}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <CardHeading>{t('radius')}</CardHeading>
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-3">
                {radii.map((r) => (
                  <li key={r.name} className="flex flex-col items-center gap-1.5">
                    <span
                      className={`${r.className} block size-14 border-2 border-primary/70 bg-accent`}
                    />
                    <span className="text-xs font-semibold">{r.name}</span>
                    {r.px !== null && (
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {r.px}px
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-3">
              <CardHeading>{t('shadow')}</CardHeading>
              <ul className="grid grid-cols-4 gap-3 rounded-lg bg-background p-4">
                {shadows.map((s) => (
                  <li key={s.name} className="flex flex-col items-center gap-2">
                    <span className={`${s.className} block h-12 w-full rounded-lg bg-card`} />
                    <span className="text-xs font-semibold">{s.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </Section>
  );
}
