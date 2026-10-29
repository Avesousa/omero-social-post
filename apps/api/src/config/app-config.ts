import { type Env } from './env.schema';

/**
 * Injectable, validated configuration. Inject it by class:
 * `constructor(private readonly config: AppConfig) {}` then read `this.config.env.X`.
 */
export class AppConfig {
  constructor(readonly env: Env) {}

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }
}
