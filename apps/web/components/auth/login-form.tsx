'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { isApiError, useAuthControllerLogin } from '@omero/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { FormField, PasswordField } from './form-field';

type LoginProblem = 'invalid' | 'throttled' | 'generic' | null;

/** Username + password login. Friendly messages for 401 (bad credentials) and 429 (throttled). */
export function LoginForm() {
  const t = useTranslations('Auth');
  const router = useRouter();
  const queryClient = useQueryClient();
  const login = useAuthControllerLogin();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<LoginProblem>(null);
  const [done, setDone] = useState(false);
  const busy = login.isPending || done;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (username.trim().length === 0 || password.length === 0) {
      setProblem('invalid');
      return;
    }
    setProblem(null);

    try {
      await login.mutateAsync({ data: { username: username.trim(), password } });
    } catch (error) {
      if (isApiError(error) && error.status === 401) setProblem('invalid');
      else if (isApiError(error) && error.status === 429) setProblem('throttled');
      else setProblem('generic');
      return;
    }
    setDone(true);
    queryClient.clear();
    router.replace('/calendar');
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {problem ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <p className="font-medium">{t(`login.problem.${problem}`)}</p>
        </div>
      ) : null}

      <FormField
        label={t('fields.username')}
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        disabled={busy}
      />

      <PasswordField
        label={t('fields.password')}
        name="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        disabled={busy}
      />

      <Button type="submit" size="lg" disabled={busy} className="mt-1 w-full">
        {busy ? <LoaderCircleIcon className="animate-spin" /> : null}
        {busy ? t('login.submitting') : t('login.submit')}
      </Button>
    </form>
  );
}
