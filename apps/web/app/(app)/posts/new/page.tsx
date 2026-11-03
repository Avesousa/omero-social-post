import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ScheduledHint } from '@/components/calendar/scheduled-hint';
import { Composer } from '@/components/composer/composer';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Shell.titles');
  return { title: t('newPost') };
}

export default async function NewPostPage({
  searchParams,
}: {
  searchParams: Promise<{ scheduledAt?: string }>;
}) {
  const { scheduledAt } = await searchParams;
  return (
    <>
      {scheduledAt ? <ScheduledHint scheduledAt={scheduledAt} /> : null}
      <Composer />
    </>
  );
}
