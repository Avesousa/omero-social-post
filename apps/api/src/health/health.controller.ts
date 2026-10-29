import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import { Public } from '../common/decorators/public.decorator';
import { HealthDto } from './health.dto';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness + dependency check used by Docker health checks. Unauthenticated. */
  @Public()
  @Get()
  @ZodResponse({ status: HttpStatus.OK, type: HealthDto, description: 'All dependencies are up' })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    // Response docs must use the DTO's Output variant (same schema as @ZodResponse).
    type: HealthDto.Output,
    description: 'At least one dependency is down',
  })
  async check(@Res({ passthrough: true }) res: Response) {
    const result = await this.health.check();
    if (result.status !== 'ok') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
