'use client';

import { CheckCircle2Icon, CircleAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { countCharacters, PROVIDER_LIMITS } from '@omero/shared';
import { NetworkAvatar } from '@/components/common/network-badge';
import { StatusBadge } from '@/components/common/status-badge';
import { type PostStatus } from '@/lib/design-tokens';
import { cn } from '@/lib/utils';
import { ComposerActions } from './composer-actions';
import { useComposer } from './context';
import { useIssueText } from './issues';

export type SaveState = 'unsaved' | 'saved' | 'dirty';

/**
 * Sticky right column. For now a simple summary of what each network will publish and the
 * list of problems; T030 swaps the summary rows for real network previews.
 */
export function SummaryPanel({
  status,
  saveState,
  canSave,
  saving,
  onSaveDraft,
}: {
  status: PostStatus;
  saveState: SaveState;
  canSave: boolean;
  saving: boolean;
  onSaveDraft: () => void;
}) {
  const t = useTranslations('Composer.summary');
  const tn = useTranslations('Network');
  const tt = useTranslations('Composer.thread');
  const describe = useIssueText();
  const { views, issues } = useComposer();

  // "X: " before problems that belong to one network, so the list is unambiguous.
  const issueLabel = (path: string) => {
    const match = /^channels\.(\d+)\./.exec(path);
    const view = match ? views.find((v) => v.index === Number(match[1])) : undefined;
    return view ? `${tn(view.channel.provider)}: ` : '';
  };

  return (
    <aside aria-label={t('title')} className="flex flex-col gap-4 lg:sticky lg:top-24">
      <section className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <StatusBadge status={status} />
        </div>

        {views.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noChannels')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {views.map((view) => {
              const limits = PROVIDER_LIMITS[view.channel.provider];
              const prefix = `channels.${view.index}.`;
              const problems = issues.filter((issue) => issue.path.startsWith(prefix)).length;
              const chars = view.items.reduce(
                (sum, item) => sum + countCharacters(item.text, limits),
                0,
              );
              return (
                <li
                  key={view.channel.id}
                  className="flex items-center gap-3 rounded-lg bg-muted/60 px-3 py-2.5"
                >
                  <NetworkAvatar network={view.channel.provider} className="size-7" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {tn(view.channel.provider)}
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        {view.channel.handle}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {limits.supportsThreads && view.items.length > 1
                        ? tt('threadOf', { count: view.items.length })
                        : t('singlePost')}
                      {' · '}
                      {t('characters', { count: chars })}
                      {view.customized ? ` · ${t('customized')}` : ''}
                    </p>
                  </div>
                  {problems > 0 ? (
                    <span
                      className="inline-flex items-center gap-1 text-xs font-semibold text-destructive"
                      aria-label={t('problems', { count: problems })}
                    >
                      <CircleAlertIcon className="size-4" />
                      {problems}
                    </span>
                  ) : (
                    <CheckCircle2Icon
                      className="size-4 text-success"
                      aria-label={t('ready')}
                      role="img"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {issues.length > 0 ? (
          <div className="rounded-lg bg-destructive/5 p-3">
            <p className="mb-1.5 text-xs font-semibold text-destructive">
              {t('fixBeforeSaving', { count: issues.length })}
            </p>
            <ul className="flex flex-col gap-1">
              {issues.slice(0, 5).map((issue, index) => (
                <li
                  key={`${issue.path}-${issue.code}-${index}`}
                  className="text-xs text-foreground/80"
                >
                  {issueLabel(issue.path)}
                  {describe(issue)}
                </li>
              ))}
              {issues.length > 5 ? (
                <li className="text-xs text-muted-foreground">
                  {t('moreProblems', { count: issues.length - 5 })}
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}

        <p
          role="status"
          className={cn(
            'text-xs font-medium',
            saveState === 'dirty' ? 'text-warning' : 'text-muted-foreground',
          )}
        >
          {t(`save.${saveState}`)}
        </p>

        <ComposerActions canSave={canSave} saving={saving} onSaveDraft={onSaveDraft} />
      </section>
    </aside>
  );
}
