import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { GeneralView } from '@/components/settings/general-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Settings.nav');
  return { title: t('general') };
}

export default function SettingsGeneralPage() {
  return <GeneralView />;
}
