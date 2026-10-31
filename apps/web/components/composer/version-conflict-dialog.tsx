'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Shown when the API answers 409 VERSION_CONFLICT: the post changed elsewhere since it was loaded. */
export function VersionConflictDialog({
  open,
  reloading,
  onReload,
  onKeepEditing,
}: {
  open: boolean;
  reloading: boolean;
  onReload: () => void;
  onKeepEditing: () => void;
}) {
  const t = useTranslations('Composer.conflict');
  const tc = useTranslations('Common');

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onKeepEditing())}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onKeepEditing} disabled={reloading}>
            {t('keep')}
          </Button>
          <Button type="button" onClick={onReload} disabled={reloading}>
            {t('reload')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
