import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SESSION_RENEW_INTERVAL_MS, SESSION_TTL_MS } from './auth.constants';
import { SessionCookie } from './session-cookie';
import { generateSessionToken, hashSessionToken, isWellFormedSessionToken } from './session-token';
import { type AuthSession } from './session.types';
import { SessionsRepository } from './sessions.repository';

export interface ClientInfo {
  userAgent?: string;
  ip?: string;
}

export interface CreatedSession {
  /** Raw token for the cookie. Never log or persist it. */
  token: string;
  sessionId: string;
  expiresAt: Date;
}

const MAX_USER_AGENT_LENGTH = 512;

/** Creates, validates (with sliding renewal) and revokes sessions. */
@Injectable()
export class SessionService {
  constructor(
    private readonly sessions: SessionsRepository,
    private readonly cookie: SessionCookie,
  ) {}

  async create(userId: string, client: ClientInfo = {}, now = new Date()): Promise<CreatedSession> {
    const token = generateSessionToken();
    const sessionId = hashSessionToken(token);
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await this.sessions.insert({
      id: sessionId,
      userId,
      expiresAt,
      lastSeenAt: now,
      userAgent: client.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
      ip: client.ip ?? null,
      createdAt: now,
    });
    return { token, sessionId, expiresAt };
  }

  /**
   * Resolves a raw cookie token to a live session. Expired rows are deleted on sight.
   * When the session was last renewed more than an hour ago, its expiry slides to
   * now + 30 days and `renewedUntil` is returned so the caller can refresh the cookie.
   */
  async validate(
    token: string | undefined,
    now = new Date(),
  ): Promise<{ session: AuthSession; renewedUntil?: Date } | null> {
    if (!isWellFormedSessionToken(token)) return null;
    const sessionId = hashSessionToken(token);
    const row = await this.sessions.findById(sessionId);
    if (!row) return null;
    if (row.expiresAt.getTime() <= now.getTime()) {
      await this.sessions.delete(sessionId);
      return null;
    }

    const session: AuthSession = { sessionId, userId: row.userId };
    if (now.getTime() - row.lastSeenAt.getTime() < SESSION_RENEW_INTERVAL_MS) return { session };

    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const staleBefore = new Date(now.getTime() - SESSION_RENEW_INTERVAL_MS);
    const renewed = await this.sessions.renew(sessionId, now, expiresAt, staleBefore);
    return renewed ? { session, renewedUntil: expiresAt } : { session };
  }

  revoke(sessionId: string): Promise<void> {
    return this.sessions.delete(sessionId);
  }

  /**
   * Full request check shared by the global guard and the Express middleware that
   * protects non-Nest routes (Bull Board, openapi.json): validates the cookie, refreshes
   * it on renewal, and attaches `req.session`. Returns the session or null.
   */
  async authenticateRequest(req: Request, res: Response): Promise<AuthSession | null> {
    const token = this.cookie.read(req);
    const result = await this.validate(token);
    if (!result) return null;
    if (result.renewedUntil && token) this.cookie.set(res, token, result.renewedUntil);
    req.session = result.session;
    return result.session;
  }
}
