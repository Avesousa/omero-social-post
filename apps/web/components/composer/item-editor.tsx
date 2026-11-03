'use client';

import { useId } from 'react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PlusIcon,
  ScissorsIcon,
  Trash2Icon,
  UndoIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { containsUrl, countCharacters, PROVIDER_LIMITS } from '@omero/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AutoTextarea } from './auto-textarea';
import { CharCounter } from './char-counter';
import { useComposer, uploadKey, type ChannelView } from './context';
import { ImageDropzone, ImageLimits } from './image-dropzone';
import { FieldIssues } from './issues';
import { LinkCostNote } from './link-cost-note';
import { seedItems, type ComposerItem } from './state';
import { issuePath } from './validation';

/** Ids of the images at positions flagged by validation (`...mediaIds.<n>`) for one item. */
function flaggedMediaIds(
  view: ChannelView,
  item: { mediaIds: readonly string[] },
  itemIndex: number,
  issuesByPath: ReadonlyMap<string, unknown>,
): Set<string> {
  const flagged = new Set<string>();
  item.mediaIds.forEach((id, mediaIndex) => {
    if (issuesByPath.has(`${issuePath(view.index, itemIndex, 'mediaIds')}.${mediaIndex}`)) {
      flagged.add(id);
    }
  });
  return flagged;
}

/** Editable thread of an X channel, or the single post of a single-post network. */
export function ItemsEditor({ view }: { view: ChannelView }) {
  const t = useTranslations('Composer.thread');
  const { state, dispatch, readOnly } = useComposer();
  const draft = state.drafts[view.channel.id];
  const items = draft?.items ?? [];
  const threads = PROVIDER_LIMITS[view.channel.provider].supportsThreads;
  const anyOver = items.some(
    (item) => countCharacters(item.text, PROVIDER_LIMITS[view.channel.provider]) > view.limit,
  );

  function autoSplit() {
    if (!anyOver) {
      toast(t('autoSplitNothing'));
      return;
    }
    dispatch({ type: 'autoSplit', channelId: view.channel.id, limit: view.limit });
    toast.success(t('autoSplitDone'));
  }

  return (
    <div className="flex flex-col gap-4">
      {threads && !readOnly ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={autoSplit}>
            <ScissorsIcon />
            {t('autoSplit')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              dispatch({
                type: 'resetItems',
                channelId: view.channel.id,
                seed: seedItems(state, view.channel),
              })
            }
          >
            <UndoIcon />
            {t('resetFromBase')}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t('autoSplitHint', { limit: view.limit })}
          </p>
        </div>
      ) : null}

      <ol className="flex flex-col">
        {items.map((item, index) => (
          <ItemCard
            key={item.key}
            view={view}
            item={item}
            index={index}
            total={items.length}
            threads={threads}
            last={index === items.length - 1}
          />
        ))}
      </ol>

      {threads && !readOnly ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              dispatch({
                type: 'addItem',
                channelId: view.channel.id,
                afterIndex: items.length - 1,
              })
            }
          >
            <PlusIcon />
            {t('addItem')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ItemCard({
  view,
  item,
  index,
  total,
  threads,
  last,
}: {
  view: ChannelView;
  item: ComposerItem;
  index: number;
  total: number;
  threads: boolean;
  last: boolean;
}) {
  const t = useTranslations('Composer.thread');
  const { state, dispatch, issuesByPath, uploading, upload, readOnly } = useComposer();
  const textId = useId();
  const errorId = `${textId}-error`;
  const { channel } = view;
  const limits = PROVIDER_LIMITS[channel.provider];
  const used = countCharacters(item.text, limits);
  const textIssues = issuesByPath.get(issuePath(view.index, index, 'text'));
  const mediaIssues = issuesByPath.get(issuePath(view.index, index, 'mediaIds'));
  const over = used > view.limit;
  const target = { kind: 'item', channelId: channel.id, itemKey: item.key } as const;

  return (
    <li className="relative flex gap-3">
      {threads ? (
        <div className="flex w-8 shrink-0 flex-col items-center">
          <span
            data-network={channel.provider}
            className="tone-solid flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums"
            aria-hidden="true"
          >
            {index + 1}
          </span>
          {last ? null : <span aria-hidden="true" className="w-0.5 flex-1 bg-border" />}
        </div>
      ) : null}

      <div className={cn('flex min-w-0 flex-1 flex-col gap-2.5', !last && 'pb-5')}>
        <div
          className={cn(
            'rounded-xl border bg-card p-3 shadow-xs transition-colors',
            over || textIssues ? 'border-destructive/60' : 'focus-within:border-ring',
          )}
        >
          <label htmlFor={textId} className="sr-only">
            {threads ? t('itemLabel', { number: index + 1 }) : t('singleLabel')}
          </label>
          <AutoTextarea
            id={textId}
            value={item.text}
            minRows={threads ? 3 : 5}
            disabled={readOnly}
            placeholder={threads ? t('itemPlaceholder') : t('singlePlaceholder')}
            aria-invalid={over || textIssues ? true : undefined}
            aria-describedby={textIssues ? errorId : undefined}
            onChange={(event) =>
              dispatch({
                type: 'setItemText',
                channelId: channel.id,
                index,
                text: event.target.value,
              })
            }
            className="border-0 bg-transparent p-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />

          <ImageDropzone
            compact
            className="mt-2"
            mediaIds={item.mediaIds}
            media={state.media}
            uploading={uploading[uploadKey(target)] ?? 0}
            readOnly={readOnly}
            invalidIds={flaggedMediaIds(view, item, index, issuesByPath)}
            onFiles={(files) => upload(target, files)}
            onRemove={(mediaId) =>
              dispatch({ type: 'removeItemMedia', channelId: channel.id, index, mediaId })
            }
          />

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2">
            <CharCounter used={used} limit={view.limit} />
            {threads && !readOnly ? (
              <div className="flex items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === 0}
                  aria-label={t('moveUp', { number: index + 1 })}
                  title={t('moveUp', { number: index + 1 })}
                  onClick={() =>
                    dispatch({ type: 'moveItem', channelId: channel.id, index, direction: -1 })
                  }
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === total - 1}
                  aria-label={t('moveDown', { number: index + 1 })}
                  title={t('moveDown', { number: index + 1 })}
                  onClick={() =>
                    dispatch({ type: 'moveItem', channelId: channel.id, index, direction: 1 })
                  }
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={total <= 1}
                  aria-label={t('remove', { number: index + 1 })}
                  title={t('remove', { number: index + 1 })}
                  className="hover:text-destructive"
                  onClick={() => dispatch({ type: 'removeItem', channelId: channel.id, index })}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <FieldIssues id={errorId} issues={[...(textIssues ?? []), ...(mediaIssues ?? [])]} />
        {channel.provider === 'x' && containsUrl(item.text) ? <LinkCostNote /> : null}
        {index === 0 ? <ImageLimits providers={[channel.provider]} /> : null}
      </div>
    </li>
  );
}

/** Read-only view of what a non-customized channel will publish, derived from the base content. */
export function DerivedItems({ view }: { view: ChannelView }) {
  const t = useTranslations('Composer.thread');
  const { state, issuesByPath } = useComposer();
  const { channel } = view;
  const limits = PROVIDER_LIMITS[channel.provider];
  const threads = limits.supportsThreads;

  return (
    <ol className="flex flex-col gap-3">
      {view.items.map((item, index) => {
        const used = countCharacters(item.text, limits);
        const textIssues = issuesByPath.get(issuePath(view.index, index, 'text'));
        const mediaIssues = issuesByPath.get(issuePath(view.index, index, 'mediaIds'));
        return (
          <li
            key={index}
            data-testid="derived-item"
            className={cn(
              'rounded-xl border bg-muted/40 p-3',
              (used > view.limit || textIssues) && 'border-destructive/60',
            )}
          >
            {threads ? (
              <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                {t('itemLabel', { number: index + 1 })}
              </p>
            ) : null}
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
              {item.text.length > 0 ? (
                item.text
              ) : (
                <span className="text-muted-foreground">{t('emptyDerived')}</span>
              )}
            </p>
            {item.mediaIds.length > 0 ? (
              <div className="mt-2">
                <ImageDropzone
                  compact
                  readOnly
                  mediaIds={item.mediaIds}
                  media={state.media}
                  uploading={0}
                  onFiles={() => undefined}
                  onRemove={() => undefined}
                  invalidIds={flaggedMediaIds(view, item, index, issuesByPath)}
                  className="border-transparent bg-transparent p-0"
                />
              </div>
            ) : null}
            <div className="mt-2 flex items-center justify-between gap-2">
              <CharCounter used={used} limit={view.limit} />
            </div>
            <FieldIssues
              issues={[...(textIssues ?? []), ...(mediaIssues ?? [])]}
              className="mt-1.5 flex flex-col gap-1"
            />
            {channel.provider === 'x' && containsUrl(item.text) ? (
              <LinkCostNote className="mt-2" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
