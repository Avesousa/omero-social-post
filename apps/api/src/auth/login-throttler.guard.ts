import { Injectable } from '@nestjs/common';
import { normalizeIp, ThrottlerGuard } from '@nestjs/throttler';

/**
 * Applied with `@UseGuards` on POST /auth/login only (no global throttling). The
 * tracker is client IP + normalized username, so one attacker cannot lock the owner out
 * from another IP, and guessing several usernames does not share one budget.
 * Guards run before pipes, hence reading the raw body here.
 */
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const ip = normalizeIp(typeof req.ip === 'string' ? req.ip : 'unknown');
    const body = req.body as { username?: unknown } | undefined;
    const username =
      typeof body?.username === 'string' ? body.username.trim().toLowerCase().slice(0, 64) : '';
    return Promise.resolve(`${ip}|${username}`);
  }
}
