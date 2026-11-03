import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { QueueView } from '@/components/settings/queue-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Settings.nav');
  return { title: t('queue') };
}

export default function SettingsQueuePage() {
  return <QueueView />;
}
