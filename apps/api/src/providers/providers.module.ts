import { Module } from '@nestjs/common';
import { OAuthStateStore } from './oauth-state.store';
import { ProviderRegistry } from './provider.registry';
import { ProvidersController } from './providers.controller';

/** Social network adapters, OAuth state storage and GET /providers. */
@Module({
  controllers: [ProvidersController],
  providers: [ProviderRegistry, OAuthStateStore],
  exports: [ProviderRegistry, OAuthStateStore],
})
export class ProvidersModule {}
