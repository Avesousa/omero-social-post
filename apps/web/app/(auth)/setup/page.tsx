import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthCard } from '@/components/auth/auth-card';
import { SetupForm } from '@/components/auth/setup-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth.setup');
  return { title: t('metaTitle') };
}

export default async function SetupPage() {
  const t = await getTranslations('Auth');
  return (
    <AuthCard title={t('setup.title')} subtitle={t('setup.subtitle')} footer={t('footer')}>
      <SetupForm />
    </AuthCard>
  );
}
