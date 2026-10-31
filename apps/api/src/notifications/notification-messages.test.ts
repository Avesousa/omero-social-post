import { describe, expect, it } from 'vitest';
import {
  buildNotification,
  escapeTelegramHtml,
  formatTelegramMessage,
  truncatePreview,
} from './notification-messages';

const ctx = { timeZone: 'America/Argentina/Buenos_Aires' };

describe('notification messages', () => {
  it('delivery_failed: network, account, reason, preview and post link', () => {
    expect(
      buildNotification(
        'delivery_failed',
        {
          postId: 'p1',
          provider: 'linkedin',
          reason: 'Token revocado',
          preview: 'Hola',
          channelHandle: 'Ada',
        },
        ctx,
      ),
    ).toEqual({
      severity: 'error',
      title: 'No se pudo publicar en LinkedIn',
      body: 'Red: LinkedIn (Ada)\nMotivo: Token revocado\nPublicación: «Hola»',
      link: '/posts/p1',
    });
  });

  it('channel_reauth: points to the channels settings', () => {
    const n = buildNotification('channel_reauth', { provider: 'x', channelHandle: 'omero' }, ctx);
    expect(n).toMatchObject({
      severity: 'error',
      title: 'La cuenta de X necesita reconexión',
      link: '/settings/channels',
    });
    expect(n.body).toContain('@omero');
  });

  it('token_expiring: formats the expiry date in the owner timezone', () => {
    const n = buildNotification(
      'token_expiring',
      { provider: 'linkedin', channelHandle: 'Ada', expiresAt: new Date('2026-11-05T15:00:00Z') },
      ctx,
    );
    expect(n.severity).toBe('warning');
    // 15:00Z is 12:00 in Buenos Aires.
    expect(n.body).toMatch(/5 de noviembre de 2026.*12:00.*America\/Argentina\/Buenos_Aires/);
  });

  it('post_missed: scheduled time, preview and post link', () => {
    const n = buildNotification(
      'post_missed',
      { postId: 'p2', preview: 'Texto', scheduledAt: new Date('2026-11-02T12:00:00Z') },
      ctx,
    );
    expect(n).toMatchObject({ severity: 'warning', link: '/posts/p2' });
    expect(n.body).toMatch(/2 de noviembre de 2026.*\b0?9:00/);
    expect(n.body).toContain('«Texto»');
  });

  it('truncates long previews without splitting emoji', () => {
    const text = '😀'.repeat(300);
    const out = truncatePreview(text);
    expect([...out]).toHaveLength(200);
    expect(out.endsWith('…')).toBe(true);
    expect(truncatePreview('  a\n\n b  ')).toBe('a b');
  });

  it('escapes Telegram HTML and builds the deep link', () => {
    expect(escapeTelegramHtml('<a href="x">&</a>')).toBe('&lt;a href="x"&gt;&amp;&lt;/a&gt;');
    expect(
      formatTelegramMessage(
        { type: 'post_missed', title: 'T <1>', body: null, link: '/posts/p?a=1&b=2' },
        'https://omero.example.ts.net',
      ),
    ).toBe(
      '⏰ <b>T &lt;1&gt;</b>\n\nAbrir en Omero: https://omero.example.ts.net/posts/p?a=1&amp;b=2',
    );
  });
});
