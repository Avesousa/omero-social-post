'use client';

import {
  BellIcon,
  CalendarClockIcon,
  CopyIcon,
  EllipsisIcon,
  InfoIcon,
  ListPlusIcon,
  PencilIcon,
  SendIcon,
  Trash2Icon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { NetworkAvatar } from '@/components/common/network-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ACTIVE_NETWORKS } from '@/lib/design-tokens';
import { CardHeading, Section } from './section';

export function ComponentsSection() {
  const t = useTranslations('DesignSystem.components');
  const tc = useTranslations('Common');
  const tn = useTranslations('Network');

  return (
    <Section id="components" title={t('title')} description={t('description')}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardContent className="space-y-5">
            <CardHeading>{t('buttons')}</CardHeading>
            <div className="flex flex-wrap items-center gap-3">
              <Button>
                <CalendarClockIcon />
                {t('button.primary')}
              </Button>
              <Button variant="crema">
                <SendIcon />
                {t('button.crema')}
              </Button>
              <Button variant="secondary">{t('button.secondary')}</Button>
              <Button variant="outline">
                <ListPlusIcon />
                {t('button.outline')}
              </Button>
              <Button variant="ghost">{t('button.ghost')}</Button>
              <Button variant="destructive">
                <Trash2Icon />
                {t('button.destructive')}
              </Button>
              <Button variant="link">{t('button.link')}</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">{t('button.small')}</Button>
              <Button size="lg">{t('button.large')}</Button>
              <Button disabled>{t('button.primary')}</Button>
              <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" aria-label={t('button.edit')}>
                    <PencilIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('button.edit')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" aria-label={t('button.duplicate')}>
                    <CopyIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('button.duplicate')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label={t('button.destructive')}
                  >
                    <Trash2Icon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('button.destructive')}</TooltipContent>
              </Tooltip>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-5">
            <CardHeading>{t('forms')}</CardHeading>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="ds-channel">{t('form.channel')}</Label>
                <Select defaultValue="x">
                  <SelectTrigger id="ds-channel" className="w-full">
                    <SelectValue placeholder={t('form.channelPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTIVE_NETWORKS.map((network) => (
                      <SelectItem key={network} value={network}>
                        <NetworkAvatar network={network} className="size-5" />
                        {tn(network)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ds-title">{t('form.content')}</Label>
                <Input id="ds-title" placeholder={t('form.contentPlaceholder')} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-muted/40 px-4 py-3">
              <div>
                <Label htmlFor="ds-long-posts">{t('form.longPosts')}</Label>
                <p className="mt-1 text-xs text-muted-foreground">{t('form.longPostsHint')}</p>
              </div>
              <Switch id="ds-long-posts" />
            </div>
            <Tabs defaultValue="base">
              <TabsList>
                <TabsTrigger value="base">{t('tabs.base')}</TabsTrigger>
                <TabsTrigger value="x">
                  <NetworkAvatar network="x" className="size-4 [&_svg]:size-2.5" />
                  {tn('x')}
                </TabsTrigger>
                <TabsTrigger value="linkedin">
                  <NetworkAvatar network="linkedin" className="size-4 [&_svg]:size-2.5" />
                  {tn('linkedin')}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="base" className="text-sm text-muted-foreground">
                {t('tabs.baseBody')}
              </TabsContent>
              <TabsContent value="x" className="text-sm text-muted-foreground">
                {t('tabs.xBody')}
              </TabsContent>
              <TabsContent value="linkedin" className="text-sm text-muted-foreground">
                {t('tabs.linkedinBody')}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-5">
            <CardHeading>{t('overlays')}</CardHeading>
            <div className="flex flex-wrap gap-3">
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2Icon />
                    {t('dialog.trigger')}
                  </Button>
                </DialogTrigger>
                <DialogContent closeLabel={tc('close')}>
                  <DialogHeader>
                    <DialogTitle>{t('dialog.title')}</DialogTitle>
                    <DialogDescription>{t('dialog.description')}</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">{tc('cancel')}</Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button variant="destructive" onClick={() => toast(t('dialog.done'))}>
                        {t('dialog.confirm')}
                      </Button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <EllipsisIcon />
                    {t('dropdown.trigger')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  <DropdownMenuItem>
                    <PencilIcon />
                    {t('dropdown.edit')}
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <CopyIcon />
                    {t('dropdown.duplicate')}
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <CalendarClockIcon />
                    {t('dropdown.reschedule')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive">
                    <Trash2Icon />
                    {t('dropdown.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline">
                    <CalendarClockIcon />
                    {t('popover.trigger')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start">
                  <p className="font-display text-base font-semibold">{t('popover.title')}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t('popover.body')}</p>
                </PopoverContent>
              </Popover>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost">
                    <InfoIcon />
                    {t('tooltip.trigger')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('tooltip.content')}</TooltipContent>
              </Tooltip>

              <Button
                variant="secondary"
                onClick={() =>
                  toast.success(t('toast.title'), { description: t('toast.description') })
                }
              >
                <BellIcon />
                {t('toast.trigger')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </Section>
  );
}
