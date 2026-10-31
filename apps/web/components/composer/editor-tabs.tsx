'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { containsUrl, countCharacters, PROVIDER_LIMITS } from '@omero/shared';
import { NetworkAvatar } from '@/components/common/network-badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { AutoTextarea } from './auto-textarea';
import { useComposer, uploadKey, type ChannelView } from './context';
import { ImageDropzone, ImageLimits } from './image-dropzone';
import { FieldIssues } from './issues';
import { DerivedItems, ItemsEditor } from './item-editor';
import { LinkCostNote } from './link-cost-note';
import { seedItems } from './state';
import { type Issue } from './validation';

const BASE_TAB = 'base';

/** Visible name of a channel tab: the network, plus the handle when two accounts share a network. */
function tabLabel(view: ChannelView, views: readonly ChannelView[], network: string): string {
  const sameNetwork = views.filter((v) => v.channel.provider === view.channel.provider).length > 1;
  return sameNetwork ? `${network} ${view.channel.handle}` : network;
}

/** Base / X / LinkedIn tabs. */
export function EditorTabs() {
  const t = useTranslations('Composer.tabs');
  const tn = useTranslations('Network');
  const { views, issues } = useComposer();
  const [requested, setRequested] = useState(BASE_TAB);
  // A tab for a channel that was just deselected falls back to the base tab.
  const active =
    requested === BASE_TAB || views.some((v) => v.channel.id === requested) ? requested : BASE_TAB;

  return (
    <Tabs value={active} onValueChange={setRequested} className="gap-4">
      <TabsList className="h-auto max-w-full flex-wrap justify-start gap-1">
        <TabsTrigger value={BASE_TAB} className="h-8 flex-none px-3.5">
          {t('base')}
        </TabsTrigger>
        {views.map((view) => {
          const hasIssue = channelHasIssues(view, issues);
          return (
            <TabsTrigger
              key={view.channel.id}
              value={view.channel.id}
              className="h-8 flex-none gap-2 px-3"
            >
              <NetworkAvatar network={view.channel.provider} className="size-4" />
              {tabLabel(view, views, tn(view.channel.provider))}
              {view.customized ? (
                <span
                  className="size-1.5 rounded-full bg-primary"
                  role="img"
                  aria-label={t('customizedDot')}
                />
              ) : null}
              {hasIssue ? (
                <span
                  className="size-1.5 rounded-full bg-destructive"
                  role="img"
                  aria-label={t('hasIssues')}
                />
              ) : null}
            </TabsTrigger>
          );
        })}
      </TabsList>

      <TabsContent value={BASE_TAB}>
        <BaseTab />
      </TabsContent>
      {views.map((view) => (
        <TabsContent key={view.channel.id} value={view.channel.id}>
          <ChannelTab view={view} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function channelHasIssues(view: ChannelView, issues: readonly Issue[]): boolean {
  const prefix = `channels.${view.index}.`;
  return issues.some((issue) => issue.path.startsWith(prefix));
}

/** Base content: the text every network without its own version publishes, plus shared images. */
function BaseTab() {
  const t = useTranslations('Composer.base');
  const tn = useTranslations('Network');
  const tt = useTranslations('Composer.thread');
  const { state, dispatch, views, uploading, upload, readOnly, issuesByPath } = useComposer();
  const textId = useId();
  const inherited = views.filter((v) => !v.customized);
  const providers = Array.from(new Set(views.map((v) => v.channel.provider)));
  const xLink = inherited.some(
    (v) => v.channel.provider === 'x' && v.items.some((item) => containsUrl(item.text)),
  );

  // Problems of derived channels are fixed here (the text or images they derive from).
  const inheritedIssues = inherited.flatMap((view) =>
    Array.from(issuesByPath.entries())
      .filter(([path]) => path.startsWith(`channels.${view.index}.`))
      .flatMap(([, list]) => list.map((issue) => ({ view, issue }))),
  );
  const invalidBaseMedia = new Set<string>();
  for (const view of inherited) {
    view.items.forEach((item, itemIndex) => {
      item.mediaIds.forEach((id, mediaIndex) => {
        if (issuesByPath.has(`channels.${view.index}.items.${itemIndex}.mediaIds.${mediaIndex}`)) {
          invalidBaseMedia.add(id);
        }
      });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card p-3 shadow-xs focus-within:border-ring">
        <label htmlFor={textId} className="sr-only">
          {t('label')}
        </label>
        <AutoTextarea
          id={textId}
          value={state.baseContent}
          minRows={6}
          disabled={readOnly}
          placeholder={t('placeholder')}
          onChange={(event) => dispatch({ type: 'setBaseContent', text: event.target.value })}
          className="border-0 bg-transparent p-1 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
      </div>

      {views.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={t('outcomeLabel')}>
          {views.map((view) => {
            const limits = PROVIDER_LIMITS[view.channel.provider];
            const total = view.items.reduce(
              (sum, item) => sum + countCharacters(item.text, limits),
              0,
            );
            const failing = view.items.some(
              (item) => countCharacters(item.text, limits) > view.limit,
            );
            return (
              <li
                key={view.channel.id}
                data-network={view.channel.provider}
                className={cn(
                  'tone-soft inline-flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-xs font-semibold',
                  failing && 'bg-destructive/10 text-destructive',
                )}
              >
                <NetworkAvatar network={view.channel.provider} className="size-5" />
                {view.customized
                  ? t('ownVersion', { network: tn(view.channel.provider) })
                  : limits.supportsThreads
                    ? view.items.length > 1
                      ? tt('threadOf', { count: view.items.length })
                      : t('singleOf', { used: total, limit: view.limit })
                    : t('singleOf', { used: total, limit: view.limit })}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('pickChannels')}</p>
      )}

      {inheritedIssues.length > 0 ? (
        <ul role="alert" className="flex flex-col gap-1.5 rounded-lg bg-destructive/5 p-3">
          {inheritedIssues.slice(0, 4).map(({ view, issue }, index) => (
            <li key={`${view.channel.id}-${issue.path}-${index}`} className="flex gap-2 text-xs">
              <NetworkAvatar network={view.channel.provider} className="mt-px size-4" />
              <FieldIssues issues={[issue]} />
            </li>
          ))}
        </ul>
      ) : null}

      {xLink ? <LinkCostNote className="self-start" /> : null}

      <div className="flex flex-col gap-2">
        <h3 className="font-sans text-sm font-semibold">{t('imagesTitle')}</h3>
        <ImageDropzone
          mediaIds={state.baseMediaIds}
          media={state.media}
          uploading={uploading[uploadKey({ kind: 'base' })] ?? 0}
          readOnly={readOnly}
          invalidIds={invalidBaseMedia}
          onFiles={(files) => upload({ kind: 'base' }, files)}
          onRemove={(mediaId) => dispatch({ type: 'removeBaseMedia', mediaId })}
        />
        <ImageLimits providers={providers} />
      </div>
    </div>
  );
}

/** One network's tab: the "personalize" switch and either the derived preview or the editable copy. */
function ChannelTab({ view }: { view: ChannelView }) {
  const t = useTranslations('Composer.channelTab');
  const tn = useTranslations('Network');
  const { state, dispatch, readOnly } = useComposer();
  const switchId = useId();
  const network = tn(view.channel.provider);
  const threads = PROVIDER_LIMITS[view.channel.provider].supportsThreads;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4 rounded-xl border bg-card p-4 shadow-xs">
        <div className="min-w-0">
          <label htmlFor={switchId} className="text-sm font-semibold">
            {t('customize', { network })}
          </label>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {view.customized
              ? threads
                ? t('customizedXHint')
                : t('customizedHint', { network })
              : t('derivedHint', { network })}
          </p>
        </div>
        <Switch
          id={switchId}
          checked={view.customized}
          disabled={readOnly}
          onCheckedChange={(checked) =>
            dispatch({
              type: 'setCustomized',
              channelId: view.channel.id,
              customized: checked,
              seed: seedItems(state, view.channel),
            })
          }
        />
      </div>

      {view.customized ? <ItemsEditor view={view} /> : <DerivedItems view={view} />}
    </div>
  );
}
