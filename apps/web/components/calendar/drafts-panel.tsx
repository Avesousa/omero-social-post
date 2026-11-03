'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FileTextIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePostsControllerList } from '@omero/api-client';
import { NetworkIcon } from '@/components/brand/network-icon';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Recent drafts. Drafts have no time, so they are not on the grid; this lists them from a
 * status-filtered query. The window is rounded to the hour so the query key stays stable.
 */
export function DraftsPanel() {
  const t = useTranslations('Calendar.drafts');
  const [range] = useState(() => {
    const hour = 3_600_000;
    const now = Math.floor(Date.now() / hour) * hour;
    return {
      from: new Date(now - 60 * 24 * hour).toISOString(),
      to: new Date(now + 2 * hour).toISOString(),
      status: 'draft',
    };
  });
  const { data, isPending, isError } = usePostsControllerList(range, {
    query: { refetchInterval: 30_000 },
  });
  const drafts = data?.items ?? [];

  return (
    <aside className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <h2 className="flex items-center gap-2 text-base font-bold">
        <FileTextIcon className="size-4 text-status-draft" />
        {t('title')}
      </h2>
      {isPending ? (
        <Skeleton className="h-16" />
      ) : isError ? (
        <p className="text-sm text-muted-foreground">{t('error')}</p>
      ) : drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {drafts.slice(0, 8).map((post) => (
            <li key={post.id}>
              <Link
                href={`/posts/${post.id}/edit`}
                data-status="draft"
                className="omero-event flex flex-col gap-1 px-2.5 py-2 text-xs hover:bg-accent"
              >
                <span className="flex gap-1 text-muted-foreground">
                  {[...new Set(post.deliveries.map((d) => d.provider))].map((p) => (
                    <NetworkIcon key={p} network={p} className="size-3" />
                  ))}
                </span>
                <span className="line-clamp-2 font-medium">{post.preview || t('noText')}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
