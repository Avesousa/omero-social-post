'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import {
  BRAND_COLORS,
  SEMANTIC_COLORS,
  type BrandColor,
  type SemanticColor,
} from '@/lib/design-tokens';
import { CardHeading, Section } from './section';

// Static class maps so Tailwind can see every utility at build time.
const brandBg: Record<BrandColor, string> = {
  espresso: 'bg-espresso',
  roast: 'bg-roast',
  lagoon: 'bg-lagoon',
  crema: 'bg-crema',
  berry: 'bg-berry',
  iris: 'bg-iris',
};

const semanticClasses: Record<SemanticColor, { dot: string; soft: string }> = {
  success: { dot: 'bg-success', soft: 'bg-success/12 text-success' },
  warning: { dot: 'bg-warning', soft: 'bg-warning/12 text-warning' },
  danger: { dot: 'bg-danger', soft: 'bg-danger/12 text-danger' },
  info: { dot: 'bg-info', soft: 'bg-info/12 text-info' },
};

export function PaletteSection() {
  const t = useTranslations('DesignSystem.palette');

  return (
    <Section id="palette" title={t('title')} description={t('description')}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="gap-4">
          <CardContent className="space-y-4">
            <CardHeading>{t('brand')}</CardHeading>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
              {BRAND_COLORS.map((color) => (
                <li key={color} className="min-w-0">
                  <div
                    className={`${brandBg[color]} h-20 rounded-lg shadow-xs ring-1 ring-black/5 ring-inset dark:ring-white/10`}
                  />
                  <p className="mt-2 text-sm font-semibold">{t(`names.${color}`)}</p>
                  <p className="text-xs leading-snug text-muted-foreground">
                    {t(`roles.${color}`)}
                  </p>
                  <code className="mt-1 inline-block text-[11px] text-muted-foreground">
                    --{color}
                  </code>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="gap-4">
          <CardContent className="space-y-4">
            <CardHeading>{t('semantic')}</CardHeading>
            <ul className="flex flex-col gap-3">
              {SEMANTIC_COLORS.map((color) => (
                <li key={color} className="flex items-center gap-3">
                  <span
                    className={`${semanticClasses[color].dot} size-10 shrink-0 rounded-md shadow-xs`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{t(`semanticNames.${color}`)}</p>
                    <code className="text-[11px] text-muted-foreground">--{color}</code>
                  </div>
                  <span
                    className={`${semanticClasses[color].soft} rounded-full px-2.5 py-0.5 text-xs font-semibold`}
                  >
                    {t(`semanticNames.${color}`)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </Section>
  );
}
