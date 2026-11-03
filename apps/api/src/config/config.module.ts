import { type DynamicModule, Module } from '@nestjs/common';
import { AppConfig } from './app-config';
import { type Env } from './env.schema';

/**
 * Global module exposing {@link AppConfig}. The env is validated before Nest boots
 * (see `main.ts` / `loadEnv`) and handed in here, so no provider ever sees invalid config.
 */
@Module({})
export class ConfigModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: AppConfig, useValue: new AppConfig(env) }],
      exports: [AppConfig],
    };
  }
}
