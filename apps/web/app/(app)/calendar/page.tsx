import { CalendarDaysIcon, SquarePenIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { PlaceholderPage } from '@/components/shell/placeholder-page';
import { buttonVariants } from '@/components/ui/button';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Shell.titles');
  return { title: t('calendar') };
}

// Placeholder: the FullCalendar views arrive with T031.
export default async function CalendarPage() {
  const t = await getTranslations('Placeholder.calendar');
  return (
    <PlaceholderPage icon={CalendarDaysIcon} title={t('title')} body={t('body')}>
      <Link href="/posts/new" className={buttonVariants({ size: 'lg' })}>
        <SquarePenIcon />
        {t('cta')}
      </Link>
    </PlaceholderPage>
  );
}
