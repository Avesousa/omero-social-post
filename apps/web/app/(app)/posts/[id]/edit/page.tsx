import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { EditPostScreen } from '@/components/composer/edit-post-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Shell.titles');
  return { title: t('editPost') };
}

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditPostScreen id={id} />;
}
