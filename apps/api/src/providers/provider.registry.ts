import { Injectable } from '@nestjs/common';
import { ERROR_HTTP_STATUS, PROVIDER_IDS, PROVIDER_LIMITS } from '@omero/shared';
import { ProblemException } from '../common/errors/problem.exception';
import { AppConfig } from '../config/app-config';
import { type Env } from '../config/env.schema';
import { LinkedInProvider } from './linkedin/linkedin.provider';
import { type ProviderId, type ProviderLimits, type SocialProvider } from './provider.types';
import { XProvider } from './x/x.provider';

/** Env variables each provider needs (both must be set). */
export const PROVIDER_ENV: Readonly<Record<ProviderId, readonly [keyof Env, keyof Env]>> = {
  x: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
  linkedin: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
};

export interface ProviderInfo {
  id: ProviderId;
  configured: boolean;
  /** Env variables still to set when not configured (shown by the Channels screen). */
  missingEnv: string[];
  limits: ProviderLimits;
}

/** `${PUBLIC_BASE_URL}/api/v1/channels/${provider}/callback`; must be registered in each developer portal. */
export function oauthRedirectUri(publicBaseUrl: string, provider: ProviderId): string {
  return `${publicBaseUrl.replace(/\/+$/, '')}/api/v1/channels/${provider}/callback`;
}

/**
 * Holds one adapter per provider whose client credentials are present in env.
 * Providers without credentials are reported as `configured: false` and cannot be used.
 */
@Injectable()
export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, SocialProvider>();

  constructor(private readonly config: AppConfig) {
    const env = config.env;
    if (env.X_CLIENT_ID && env.X_CLIENT_SECRET) {
      this.register(
        new XProvider({
          clientId: env.X_CLIENT_ID,
          clientSecret: env.X_CLIENT_SECRET,
          redirectUri: oauthRedirectUri(env.PUBLIC_BASE_URL, 'x'),
        }),
      );
    }
    if (env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET) {
      this.register(
        new LinkedInProvider({
          clientId: env.LINKEDIN_CLIENT_ID,
          clientSecret: env.LINKEDIN_CLIENT_SECRET,
          redirectUri: oauthRedirectUri(env.PUBLIC_BASE_URL, 'linkedin'),
        }),
      );
    }
  }

  /** Replaces or adds an adapter (tests can register fakes). */
  register(provider: SocialProvider): void {
    this.providers.set(provider.id, provider);
  }

  isConfigured(id: ProviderId): boolean {
    return this.providers.has(id);
  }

  /** The adapter, or undefined when its credentials are not configured. */
  find(id: ProviderId): SocialProvider | undefined {
    return this.providers.get(id);
  }

  /** The adapter; throws a 409 CHANNEL_NOT_CONFIGURED problem when it is not configured. */
  get(id: ProviderId): SocialProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new ProblemException({
        status: ERROR_HTTP_STATUS.CHANNEL_NOT_CONFIGURED,
        code: 'CHANNEL_NOT_CONFIGURED',
        detail: `Set ${PROVIDER_ENV[id].join(' and ')} to enable ${id}.`,
      });
    }
    return provider;
  }

  redirectUri(id: ProviderId): string {
    return oauthRedirectUri(this.config.env.PUBLIC_BASE_URL, id);
  }

  list(): ProviderInfo[] {
    return PROVIDER_IDS.map((id) => ({
      id,
      configured: this.isConfigured(id),
      missingEnv: this.isConfigured(id)
        ? []
        : PROVIDER_ENV[id].filter((name) => !this.config.env[name]),
      limits: this.providers.get(id)?.limits ?? PROVIDER_LIMITS[id],
    }));
  }
}
