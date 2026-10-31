import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthCard } from '@/components/auth/auth-card';
import { LoginForm } from '@/components/auth/login-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth.login');
  return { title: t('metaTitle') };
}

export default async function LoginPage() {
  const t = await getTranslations('Auth');
  return (
    <AuthCard title={t('login.title')} subtitle={t('login.subtitle')} footer={t('footer')}>
      <LoginForm />
    </AuthCard>
  );
}
