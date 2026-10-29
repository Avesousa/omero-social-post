import { Injectable } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { AppConfig } from '../config/app-config';
import { SESSION_COOKIE } from './auth.constants';

/**
 * Writes and clears the `omero_session` cookie: HttpOnly, SameSite=Lax, Path=/, and
 * Secure whenever PUBLIC_BASE_URL is https (always the case behind Tailscale serve).
 */
@Injectable()
export class SessionCookie {
  private readonly base: CookieOptions;

  constructor(config: AppConfig) {
    this.base = {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: new URL(config.env.PUBLIC_BASE_URL).protocol === 'https:',
    };
  }

  read(req: Request): string | undefined {
    const value = (req.cookies as Record<string, unknown> | undefined)?.[SESSION_COOKIE];
    return typeof value === 'string' ? value : undefined;
  }

  set(res: Response, token: string, expiresAt: Date): void {
    res.cookie(SESSION_COOKIE, token, { ...this.base, expires: expiresAt });
  }

  clear(res: Response): void {
    res.clearCookie(SESSION_COOKIE, this.base);
  }
}
