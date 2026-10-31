'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LockIcon, SearchXIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { isApiError, usePostsControllerGet } from '@omero/api-client';
import { StatusBadge } from '@/components/common/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Composer } from './composer';

const EDITABLE = new Set(['draft', 'scheduled']);

/** `/posts/[id]/edit`: loads the post and opens the composer when its status allows editing. */
export function EditPostScreen({ id }: { id: string }) {
  const t = useTranslations('Composer.edit');
  const [reloadNonce, setReloadNonce] = useState(0);
  const [reloading, setReloading] = useState(false);
  // Always show the server's latest version when the screen opens.
  const {
    data: post,
    error,
    isPending,
    refetch,
  } = usePostsControllerGet(id, {
    query: { staleTime: 0, refetchOnMount: 'always' },
  });

  if (isPending) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]" aria-busy="true">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  if (error) {
    const missing = isApiError(error) && error.status === 404;
    return (
      <Notice
        icon={<SearchXIcon className="size-7" />}
        title={missing ? t('notFoundTitle') : t('errorTitle')}
      >
        <p className="max-w-[46ch] text-muted-foreground">
          {missing ? t('notFoundBody') : t('errorBody')}
        </p>
      </Notice>
    );
  }

  if (!EDITABLE.has(post.status)) {
    return (
      <Notice icon={<LockIcon className="size-7" />} title={t('lockedTitle')}>
        <StatusBadge status={post.status} />
        <p className="max-w-[46ch] text-muted-foreground">
          {post.status === 'publishing' ? t('publishingBody') : t('lockedBody')}
        </p>
      </Notice>
    );
  }

  async function reload() {
    setReloading(true);
    try {
      await refetch();
      setReloadNonce((n) => n + 1);
    } finally {
      setReloading(false);
    }
  }

  return (
    <Composer
      key={`${post.id}:${reloadNonce}`}
      initialPost={post}
      onReload={reload}
      reloading={reloading}
    />
  );
}

function Notice({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const t = useTranslations('Composer.edit');
  return (
    <section className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card/60 px-6 py-20 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        {icon}
      </span>
      <h2 className="text-2xl font-bold tracking-[-0.03em]">{title}</h2>
      {children}
      <Link href="/calendar" className={buttonVariants({ variant: 'outline' })}>
        {t('backToCalendar')}
      </Link>
    </section>
  );
}
