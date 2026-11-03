'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircleIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { isApiError, useAuthControllerSetup, useSettingsControllerUpdate } from '@omero/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { PASSWORD_MIN_LENGTH } from '@/lib/password-strength';
import { FormField, PasswordField } from './form-field';
import { PasswordStrengthMeter } from './password-strength-meter';

type Field = 'username' | 'password' | 'confirm';
type FieldErrors = Partial<Record<Field, string>>;

const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

/** Browser time zone, sent to the API so queue slots and the calendar start in the right zone. */
function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** First-run form: creates the owner account, stores the browser time zone, then opens the app. */
export function SetupForm() {
  const t = useTranslations('Auth');
  const router = useRouter();
  const queryClient = useQueryClient();
  const setup = useAuthControllerSetup();
  const updateSettings = useSettingsControllerUpdate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const timeZone = browserTimeZone();
  const busy = setup.isPending || updateSettings.isPending || done;

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (username.length < 3 || username.length > 32 || !USERNAME_PATTERN.test(username)) {
      next.username = t('validation.usernameFormat');
    }
    if (password.length < PASSWORD_MIN_LENGTH) next.password = t('validation.passwordMin');
    if (confirm !== password) next.confirm = t('validation.confirmMismatch');
    return next;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    try {
      await setup.mutateAsync({ data: { username, password } });
    } catch (error) {
      if (isApiError(error) && error.status === 409) {
        // Somebody (or an earlier tab) already created the owner.
        toast(t('setup.alreadyDone'));
        router.replace('/login');
        return;
      }
      if (isApiError(error) && error.status === 422) {
        const next: FieldErrors = {};
        for (const issue of error.errors) {
          if (issue.path === 'username') next.username = t('validation.usernameFormat');
          if (issue.path === 'password') next.password = t('validation.passwordMin');
        }
        setErrors(next);
        if (Object.keys(next).length > 0) return;
      }
      setFormError(t('setup.failed'));
      return;
    }

    // The session cookie is set now. The time zone is best effort: a failure must not block entry.
    if (timeZone) {
      try {
        await updateSettings.mutateAsync({ data: { timezone: timeZone } });
      } catch {
        toast(t('setup.timezoneNotSaved'));
      }
    }
    setDone(true);
    queryClient.clear();
    router.replace('/calendar');
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {formError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
        >
          {formError}
        </p>
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
        error={errors.username}
        hint={t('setup.usernameHint')}
        disabled={busy}
      />

      <PasswordField
        label={t('fields.password')}
        name="password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={errors.password}
        disabled={busy}
      >
        <PasswordStrengthMeter password={password} />
      </PasswordField>

      <PasswordField
        label={t('fields.confirmPassword')}
        name="confirm-password"
        autoComplete="new-password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        error={errors.confirm}
        disabled={busy}
      />

      <Button type="submit" size="lg" disabled={busy} className="mt-1 w-full">
        {busy ? <LoaderCircleIcon className="animate-spin" /> : null}
        {busy ? t('setup.submitting') : t('setup.submit')}
      </Button>

      {timeZone ? (
        <p className="text-center text-xs text-muted-foreground">
          {t('setup.timezoneNote', { timezone: timeZone })}
        </p>
      ) : null}
    </form>
  );
}
