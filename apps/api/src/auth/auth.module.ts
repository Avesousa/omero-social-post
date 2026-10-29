import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { type Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { LOGIN_THROTTLE } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginThrottlerGuard } from './login-throttler.guard';
import { PasswordService } from './password.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { SessionAuthMiddleware } from './session-auth.middleware';
import { SessionCookie } from './session-cookie';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';
import { SessionsRepository } from './sessions.repository';
import { UsersRepository } from './users.repository';

/**
 * Owner account, sessions and request authentication.
 *
 * Global so that SessionService / SessionAuthMiddleware resolve anywhere, including in
 * Bull Board's root module (see QueuesModule). Registers SessionGuard as APP_GUARD:
 * every route is private unless marked `@Public()`.
 */
@Global()
@Module({
  imports: [
    // Only the login route uses it (LoginThrottlerGuard); nothing is throttled globally.
    // Other throttled routes should add a named throttler and skip `login` with
    // @SkipThrottle({ login: true }).
    ThrottlerModule.forRootAsync({
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => ({
        throttlers: [
          { name: LOGIN_THROTTLE.name, limit: LOGIN_THROTTLE.limit, ttl: LOGIN_THROTTLE.ttlMs },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    UsersRepository,
    SessionsRepository,
    PasswordService,
    SessionCookie,
    SessionService,
    AuthService,
    LoginThrottlerGuard,
    SessionAuthMiddleware,
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [SessionService, SessionCookie, SessionAuthMiddleware, AuthService],
})
export class AuthModule {}
