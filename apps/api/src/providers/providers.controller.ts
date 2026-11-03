import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ProviderRegistry } from './provider.registry';
import { ProviderInfoDto } from './providers.dto';

@ApiTags('providers')
@Controller('providers')
export class ProvidersController {
  constructor(private readonly registry: ProviderRegistry) {}

  /** Supported networks, whether their credentials are configured, and their publishing limits. */
  @Get()
  @ZodResponse({
    status: HttpStatus.OK,
    type: [ProviderInfoDto],
    description: 'All supported providers',
  })
  list() {
    return this.registry.list();
  }
}
