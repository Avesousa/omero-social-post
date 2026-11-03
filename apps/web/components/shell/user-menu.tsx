'use client';

import { useRouter } from 'next/navigation';
import { ChevronDownIcon, LogOutIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useAuthControllerLogout, useAuthControllerMe } from '@omero/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Two-letter avatar text from a username such as "avelino.s". */
export function initialsOf(username: string): string {
  const letters = username.replace(/[^a-z0-9]/gi, '');
  return (letters.slice(0, 2) || '?').toUpperCase();
}

/** Account dropdown: who is signed in and the logout action. */
export function UserMenu() {
  const t = useTranslations('Shell.user');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: me } = useAuthControllerMe();
  const logout = useAuthControllerLogout();

  async function signOut() {
    try {
      await logout.mutateAsync();
    } catch {
      toast.error(t('logoutFailed'));
      return;
    }
    // Drop everything cached for the old session before showing the login screen.
    queryClient.clear();
    router.replace('/login');
  }

  if (!me) return <Skeleton className="h-9 w-24 rounded-full" />;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('menu', { username: me.username })}
          className="flex h-9 items-center gap-2 rounded-full border border-input bg-card py-0.5 pr-2.5 pl-0.5 text-sm font-semibold shadow-xs transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent dark:bg-input/20"
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-crema text-xs font-bold text-espresso">
              {initialsOf(me.username)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-32 truncate sm:inline">{me.username}</span>
          <ChevronDownIcon className="hidden size-3.5 text-muted-foreground sm:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-muted-foreground">{t('signedInAs')}</span>
          <span className="truncate text-sm font-semibold">{me.username}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()} disabled={logout.isPending}>
          <LogOutIcon />
          {t('logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
