'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  getPostsControllerGetQueryKey,
  isApiError,
  useMediaControllerUpload,
  usePostsControllerCreate,
  usePostsControllerUpdate,
  type PostDetailDtoOutput,
} from '@omero/api-client';
import { type PostStatus } from '@/lib/design-tokens';
import { ChannelPicker } from './channel-picker';
import { ComposerProvider, uploadKey, type ChannelView, type UploadTarget } from './context';
import { EditorTabs } from './editor-tabs';
import {
  composerReducer,
  emptyState,
  itemsForChannel,
  limitForChannel,
  stateFromPost,
  toPostInput,
  type ComposerAction,
  type ComposerState,
  type MediaRef,
} from './state';
import { SummaryPanel, type SaveState } from './summary-panel';
import { useChannels } from './use-channels';
import { groupByPath, issuesFromProblem, validateComposer, type Issue } from './validation';
import { VersionConflictDialog } from './version-conflict-dialog';

/** Largest upload the media endpoint accepts. */
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const UPLOAD_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Problems the user has not had a chance to fix yet; they only show after a save attempt. */
const SOFT_CODES = new Set(['NO_CHANNELS', 'EMPTY_ITEM', 'ITEMS_REQUIRED']);

function isPristine(state: ComposerState): boolean {
  return (
    state.baseContent.trim() === '' &&
    state.selected.length === 0 &&
    state.baseMediaIds.length === 0
  );
}

/**
 * The post composer: channel picker, Base / per-network tabs and the sticky summary.
 * Creates a draft with `POST /posts`, or saves an existing one with `PUT` and its `version`.
 */
export function Composer({
  initialPost,
  onReload,
  reloading = false,
  readOnly = false,
}: {
  /** Saved post to edit; omit for a new one. */
  initialPost?: PostDetailDtoOutput;
  /** Called when the owner chooses to discard local edits after a version conflict. */
  onReload?: () => Promise<void> | void;
  reloading?: boolean;
  readOnly?: boolean;
}) {
  const t = useTranslations('Composer');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { channels, isPending, isError } = useChannels();

  const [state, rawDispatch] = useReducer(composerReducer, initialPost, (post): ComposerState =>
    post ? stateFromPost(post) : emptyState(),
  );
  const [postId, setPostId] = useState(initialPost?.id);
  const [version, setVersion] = useState(initialPost?.version);
  const [status, setStatus] = useState<PostStatus>(initialPost?.status ?? 'draft');
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(() =>
    initialPost ? JSON.stringify(toPostInput(stateFromPost(initialPost))) : null,
  );
  const [serverIssues, setServerIssues] = useState<Issue[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [uploading, setUploading] = useState<Record<string, number>>({});

  const createPost = usePostsControllerCreate();
  const updatePost = usePostsControllerUpdate();
  const { mutateAsync: uploadAsync } = useMediaControllerUpload();
  const saving = createPost.isPending || updatePost.isPending;

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Any edit invalidates the server's answer for the previous version of the form.
  const dispatch = useCallback((action: ComposerAction) => {
    setServerIssues((previous) => (previous.length > 0 ? [] : previous));
    rawDispatch(action);
  }, []);

  /* ------------------------------ derived data ------------------------------ */

  const views = useMemo<ChannelView[]>(() => {
    const byId = new Map(channels.map((channel) => [channel.id, channel]));
    return state.selected.flatMap((channelId, index) => {
      const channel = byId.get(channelId);
      if (!channel) return [];
      const draft = state.drafts[channelId];
      return [
        {
          channel,
          index,
          draft,
          customized: Boolean(draft?.customized && draft.items),
          items: itemsForChannel(state, channel),
          limit: limitForChannel(channel),
        },
      ];
    });
  }, [channels, state]);

  const clientIssues = useMemo(() => validateComposer(state, channels), [state, channels]);

  const allIssues = useMemo(() => {
    const seen = new Set(clientIssues.map((issue) => `${issue.path}|${issue.code}`));
    return [...clientIssues, ...serverIssues.filter((i) => !seen.has(`${i.path}|${i.code}`))];
  }, [clientIssues, serverIssues]);

  const visibleIssues = useMemo(
    () => (attempted ? allIssues : allIssues.filter((issue) => !SOFT_CODES.has(issue.code))),
    [allIssues, attempted],
  );
  const issuesByPath = useMemo(() => groupByPath(visibleIssues), [visibleIssues]);
  const hardIssues = allIssues.filter((issue) => !SOFT_CODES.has(issue.code));

  const uploadingTotal = Object.values(uploading).reduce((sum, n) => sum + n, 0);
  const currentSnapshot = JSON.stringify(toPostInput(state));
  const isDirty = postId ? currentSnapshot !== savedSnapshot : !isPristine(state);
  const saveState: SaveState = postId ? (isDirty ? 'dirty' : 'saved') : 'unsaved';
  const canSave = !readOnly && !saving && uploadingTotal === 0 && hardIssues.length === 0;

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  /* --------------------------------- uploads -------------------------------- */

  const bumpUploading = useCallback((key: string, delta: number) => {
    setUploading((previous) => ({ ...previous, [key]: Math.max(0, (previous[key] ?? 0) + delta) }));
  }, []);

  const upload = useCallback(
    (target: UploadTarget, files: File[]) => {
      const key = uploadKey(target);

      async function uploadOne(file: File): Promise<MediaRef | null> {
        if (!UPLOAD_MIMES.has(file.type)) {
          toast.error(t('images.unsupported', { name: file.name }));
          return null;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          toast.error(t('images.tooLarge', { name: file.name }));
          return null;
        }
        bumpUploading(key, 1);
        try {
          const media = await uploadAsync({ data: { file } });
          return {
            id: media.id,
            url: media.url,
            mime: media.mime,
            bytes: media.bytes,
            width: media.width,
            height: media.height,
          };
        } catch (error) {
          if (isApiError(error) && error.status === 413) {
            toast.error(t('images.tooLarge', { name: file.name }));
          } else if (isApiError(error) && error.status === 415) {
            toast.error(t('images.unsupported', { name: file.name }));
          } else {
            toast.error(t('images.uploadFailed', { name: file.name }));
          }
          return null;
        } finally {
          bumpUploading(key, -1);
        }
      }

      // Uploads run in parallel; results are attached in the order the files were chosen.
      const jobs = files.map(uploadOne);
      void (async () => {
        for (const job of jobs) {
          const media = await job;
          if (!media) continue;
          dispatch({ type: 'registerMedia', media });
          if (target.kind === 'base') {
            dispatch({ type: 'addBaseMedia', mediaId: media.id });
            continue;
          }
          const items = stateRef.current.drafts[target.channelId]?.items;
          const index = items?.findIndex((item) => item.key === target.itemKey) ?? -1;
          if (index >= 0) {
            dispatch({
              type: 'addItemMedia',
              channelId: target.channelId,
              index,
              mediaId: media.id,
            });
          }
        }
      })();
    },
    [bumpUploading, dispatch, t, uploadAsync],
  );

  /* ---------------------------------- save ---------------------------------- */

  async function saveDraft() {
    if (readOnly || saving) return;
    setAttempted(true);
    if (allIssues.length > 0) {
      toast.error(t('save.blocked', { count: allIssues.length }));
      return;
    }

    const input = toPostInput(state);
    try {
      const detail =
        postId && version !== undefined
          ? await updatePost.mutateAsync({ id: postId, data: { ...input, version } })
          : await createPost.mutateAsync({ data: input });

      queryClient.setQueryData(getPostsControllerGetQueryKey(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: ['/api/v1/posts'] });
      setPostId(detail.id);
      setVersion(detail.version);
      setStatus(detail.status);
      setSavedSnapshot(JSON.stringify(input));
      setServerIssues([]);
      toast.success(postId ? t('save.updated') : t('save.created'));
      if (!postId) router.replace(`/posts/${detail.id}/edit`);
    } catch (error) {
      if (isApiError(error) && error.status === 422) {
        setServerIssues(issuesFromProblem(error.errors));
        toast.error(t('save.rejected'));
      } else if (isApiError(error) && error.code === 'VERSION_CONFLICT') {
        setConflict(true);
      } else if (isApiError(error) && error.code === 'FORBIDDEN_STATE') {
        toast.error(t('save.notEditable'));
      } else if (isApiError(error) && error.status === 404) {
        toast.error(t('save.gone'));
      } else {
        toast.error(t('save.failed'));
      }
    }
  }

  async function reloadAfterConflict() {
    await onReload?.();
    setConflict(false);
  }

  /* --------------------------------- render --------------------------------- */

  const context = {
    state,
    dispatch,
    channels,
    views,
    issues: visibleIssues,
    issuesByPath,
    uploading,
    upload,
    readOnly,
  };

  return (
    <ComposerProvider value={context}>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_368px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
            <h2 className="text-lg font-semibold">{t('channels.title')}</h2>
            <ChannelPicker
              channels={channels}
              selected={state.selected}
              onToggle={(channelId) => dispatch({ type: 'toggleChannel', channelId })}
              isPending={isPending}
              isError={isError}
              readOnly={readOnly}
              invalid={attempted && state.selected.length === 0}
            />
            {attempted && state.selected.length === 0 && channels.length > 0 ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                {t('issues.NO_CHANNELS')}
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
            <h2 className="text-lg font-semibold">{t('content.title')}</h2>
            <EditorTabs />
          </section>
        </div>

        <SummaryPanel
          status={status}
          saveState={saveState}
          canSave={canSave}
          saving={saving}
          onSaveDraft={() => void saveDraft()}
        />
      </div>

      <VersionConflictDialog
        open={conflict}
        reloading={reloading}
        onReload={() => void reloadAfterConflict()}
        onKeepEditing={() => setConflict(false)}
      />
    </ComposerProvider>
  );
}
