import { type DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { AuthModule } from './auth/auth.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { buildLoggerParams } from './common/logging/logger.options';
import { ChannelsModule } from './channels/channels.module';
import { ConfigModule } from './config/config.module';
import { type Env } from './config/env.schema';
import { CryptoModule } from './crypto/crypto.module';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MediaModule } from './media/media.module';
import { PostsModule } from './posts/posts.module';
import { ProvidersModule } from './providers/providers.module';
import { QueuesModule } from './queues/queues.module';
import { WorkersModule } from './queues/workers.module';
import { RedisModule } from './redis/redis.module';
import { SettingsModule } from './settings/settings.module';

/**
 * Root module, built from an already validated env so that composition decisions
 * (e.g. WORKERS_ENABLED) never read `process.env` at import time.
 *
 * New domain modules go in `imports` below; their processors go in WorkersModule.
 */
@Module({})
export class AppModule {
  static register(env: Env, extra: Pick<ModuleMetadata, 'imports'> = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        LoggerModule.forRoot(buildLoggerParams(env)),
        DbModule,
        RedisModule,
        CryptoModule,
        // Registers the global SessionGuard: every route is private unless @Public().
        AuthModule,
        QueuesModule,
        HealthModule,
        SettingsModule,
        NotificationsModule,
        MediaModule,
        PostsModule,
        ProvidersModule,
        ChannelsModule,
        ...(env.WORKERS_ENABLED ? [WorkersModule] : []),
        ...(extra.imports ?? []),
      ],
      providers: [
        // Validates @Body/@Query/@Param typed with nestjs-zod DTOs.
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        // Strips/validates responses declared with @ZodResponse / @ZodSerializerDto.
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
        // Every error becomes application/problem+json.
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
