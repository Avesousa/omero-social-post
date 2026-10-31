import { Settings2Icon } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PlaceholderPage } from '@/components/shell/placeholder-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Shell.titles');
  return { title: t('settings') };
}

// Placeholder: channels, queue slots and general settings arrive with T028.
export default async function SettingsPage() {
  const t = await getTranslations('Placeholder.settings');
  return <PlaceholderPage icon={Settings2Icon} title={t('title')} body={t('body')} />;
}
