import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Composer } from '@/components/composer/composer';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Shell.titles');
  return { title: t('newPost') };
}

export default function NewPostPage() {
  return <Composer />;
}
