import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ChannelsView } from '@/components/settings/channels-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Settings.nav');
  return { title: t('channels') };
}

export default function SettingsChannelsPage() {
  return <ChannelsView />;
}
