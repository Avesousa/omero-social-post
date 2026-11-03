import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CalendarView } from '@/components/calendar/calendar-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Shell.titles');
  return { title: t('calendar') };
}

export default function CalendarPage() {
  return <CalendarView />;
}
