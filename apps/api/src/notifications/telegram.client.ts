import { Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { AppConfig } from '../config/app-config';

export const TELEGRAM_API_BASE = 'https://api.telegram.org';

const REQUEST_TIMEOUT_MS = 10_000;

interface TelegramResponse {
  ok: boolean;
  description?: string;
  result?: { message_id?: number };
}

/**
 * Minimal Telegram Bot API client (outbound `sendMessage` only). The bot token is part
 * of the request URL, so the URL is never logged nor put in error messages.
 */
@Injectable()
export class TelegramClient {
  constructor(private readonly config: AppConfig) {}

  get isConfigured(): boolean {
    return Boolean(this.config.env.TELEGRAM_BOT_TOKEN && this.config.env.TELEGRAM_CHAT_ID);
  }

  /**
   * Sends an HTML message to the configured chat and returns its message id.
   * Throws a retryable Error on network errors, 429 and 5xx, and an
   * UnrecoverableError on other rejections (bad token, chat id or markup).
   */
  async sendMessage(html: string): Promise<number | undefined> {
    const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = this.config.env;
    if (!token || !chatId) throw new UnrecoverableError('Telegram is not configured');

    let res: Response;
    try {
      res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: html,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Never forward the original error: some runtimes include the URL (and token).
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network';
      throw new Error(`Telegram sendMessage failed (${reason})`);
    }

    const body = (await res.json().catch(() => ({ ok: false }))) as TelegramResponse;
    if (res.ok && body.ok) return body.result?.message_id;

    const detail = `Telegram sendMessage failed: HTTP ${res.status}${body.description ? ` ${body.description}` : ''}`;
    // TODO: honour `parameters.retry_after` on 429 instead of the generic backoff.
    if (res.status === 429 || res.status >= 500) throw new Error(detail);
    throw new UnrecoverableError(detail);
  }
}
