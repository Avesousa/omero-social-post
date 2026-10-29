import {
  type NotificationSeverity,
  type NotificationType,
  type Provider,
} from '../db/schema/enums';

// Spanish, user-facing texts for each notification type. The same title/body are
// stored in the notifications row (in-app tray) and sent to Telegram.

/** Data the worker/reconciler has at hand when each notification is raised. */
export interface NotificationPayloads {
  /** A channel delivery failed for good (retries exhausted or a permanent error). */
  delivery_failed: {
    postId: string;
    provider: Provider;
    /** Human-readable reason, e.g. the provider's error message. */
    reason: string;
    /** Start of the post text. */
    preview: string;
    channelHandle?: string;
  };
  /** The channel's token was rejected; the owner must reconnect it. */
  channel_reauth: {
    provider: Provider;
    channelHandle: string;
    /** Set when the problem surfaced while publishing a post. */
    postId?: string;
    reason?: string;
  };
  /** The channel's token expires soon (LinkedIn: 7 days before). */
  token_expiring: {
    provider: Provider;
    channelHandle: string;
    expiresAt: Date;
  };
  /** The server was down past the grace window; the post was not published. */
  post_missed: {
    postId: string;
    preview: string;
    scheduledAt: Date;
  };
}

export interface NotificationContent {
  severity: NotificationSeverity;
  title: string;
  body: string;
  /** In-app path (prefixed with PUBLIC_BASE_URL for Telegram deep links). */
  link: string;
}

export interface MessageContext {
  /** Owner's IANA time zone, used to format dates. */
  timeZone: string;
}

const PREVIEW_MAX_CHARS = 200;

export const PROVIDER_LABEL: Readonly<Record<Provider, string>> = {
  x: 'X',
  linkedin: 'LinkedIn',
};

/** Emoji that prefixes each type in Telegram. */
export const NOTIFICATION_EMOJI: Readonly<Record<NotificationType, string>> = {
  delivery_failed: '❌',
  channel_reauth: '🔌',
  token_expiring: '⏳',
  post_missed: '⏰',
};

const CHANNELS_LINK = '/settings/channels';
const postLink = (postId: string) => `/posts/${postId}`;

export function formatAccount(provider: Provider, handle: string): string {
  return provider === 'x' && !handle.startsWith('@') ? `@${handle}` : handle;
}

export function truncatePreview(text: string, max = PREVIEW_MAX_CHARS): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  // Count code points so an emoji is never cut in half.
  const chars = [...clean];
  return chars.length <= max
    ? clean
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

export function formatDateTime(date: Date, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat('es', {
    timeZone,
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
  return `${formatted} (${timeZone})`;
}

export function deliveryFailedMessage(
  p: NotificationPayloads['delivery_failed'],
): NotificationContent {
  const network = PROVIDER_LABEL[p.provider];
  const account = p.channelHandle ? ` (${formatAccount(p.provider, p.channelHandle)})` : '';
  return {
    severity: 'error',
    title: `No se pudo publicar en ${network}`,
    body: [
      `Red: ${network}${account}`,
      `Motivo: ${p.reason}`,
      `Publicación: «${truncatePreview(p.preview)}»`,
    ].join('\n'),
    link: postLink(p.postId),
  };
}

export function channelReauthMessage(
  p: NotificationPayloads['channel_reauth'],
): NotificationContent {
  const network = PROVIDER_LABEL[p.provider];
  const account = formatAccount(p.provider, p.channelHandle);
  const lines = [
    `El acceso a la cuenta ${account} de ${network} venció o fue revocado.`,
    'Las publicaciones programadas en este canal no se van a publicar hasta reconectarlo.',
  ];
  if (p.reason) lines.push(`Motivo: ${p.reason}`);
  return {
    severity: 'error',
    title: `La cuenta de ${network} necesita reconexión`,
    body: lines.join('\n'),
    link: CHANNELS_LINK,
  };
}

export function tokenExpiringMessage(
  p: NotificationPayloads['token_expiring'],
  ctx: MessageContext,
): NotificationContent {
  const network = PROVIDER_LABEL[p.provider];
  const account = formatAccount(p.provider, p.channelHandle);
  return {
    severity: 'warning',
    title: `El acceso a ${network} vence pronto`,
    body: [
      `La autorización de la cuenta ${account} vence el ${formatDateTime(p.expiresAt, ctx.timeZone)}.`,
      'Hay que reconectarla antes de esa fecha para que las publicaciones programadas no fallen.',
    ].join('\n'),
    link: CHANNELS_LINK,
  };
}

export function postMissedMessage(
  p: NotificationPayloads['post_missed'],
  ctx: MessageContext,
): NotificationContent {
  return {
    severity: 'warning',
    title: 'Una publicación programada no se publicó',
    body: [
      `Estaba programada para el ${formatDateTime(p.scheduledAt, ctx.timeZone)} y el servidor no estaba disponible a esa hora.`,
      'No se publicó automáticamente; se puede reprogramar desde la app.',
      `Publicación: «${truncatePreview(p.preview)}»`,
    ].join('\n'),
    link: postLink(p.postId),
  };
}

/** Builds the Spanish title/body/link for any notification type. */
export function buildNotification<T extends NotificationType>(
  type: T,
  payload: NotificationPayloads[T],
  ctx: MessageContext,
): NotificationContent {
  switch (type) {
    case 'delivery_failed':
      return deliveryFailedMessage(payload as NotificationPayloads['delivery_failed']);
    case 'channel_reauth':
      return channelReauthMessage(payload as NotificationPayloads['channel_reauth']);
    case 'token_expiring':
      return tokenExpiringMessage(payload as NotificationPayloads['token_expiring'], ctx);
    case 'post_missed':
      return postMissedMessage(payload as NotificationPayloads['post_missed'], ctx);
    default:
      throw new Error(`Unknown notification type "${String(type)}"`);
  }
}

/** Escapes text for Telegram `parse_mode: HTML` (only &, < and > are special). */
export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Telegram message for a stored notification: emoji + bold title, body and a deep link.
 * The link is plain text (auto-linked by Telegram), so private hosts such as a
 * Tailscale name never make Telegram reject the HTML entities.
 */
export function formatTelegramMessage(
  n: { type: NotificationType; title: string; body: string | null; link: string | null },
  publicBaseUrl: string,
): string {
  const parts = [`${NOTIFICATION_EMOJI[n.type]} <b>${escapeTelegramHtml(n.title)}</b>`];
  if (n.body) parts.push(escapeTelegramHtml(n.body));
  if (n.link) parts.push(`Abrir en Omero: ${escapeTelegramHtml(`${publicBaseUrl}${n.link}`)}`);
  return parts.join('\n\n');
}
