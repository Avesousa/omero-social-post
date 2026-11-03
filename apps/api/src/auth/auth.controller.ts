import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import { Public } from '../common/decorators/public.decorator';
import { SESSION_COOKIE } from './auth.constants';
import { LoginDto, MeDto, SetupDto, SetupStatusDto } from './auth.dto';
import { AuthService } from './auth.service';
import { CurrentSession } from './current-session.decorator';
import { LoginThrottlerGuard } from './login-throttler.guard';
import { SessionCookie } from './session-cookie';
import { type ClientInfo } from './session.service';
import { type AuthSession } from './session.types';

function clientInfo(req: Request): ClientInfo {
  return { userAgent: req.get('user-agent') ?? undefined, ip: req.ip };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookie: SessionCookie,
  ) {}

  /** Whether the owner account still has to be created (first run). */
  @Public()
  @Get('setup-status')
  @ZodResponse({ status: HttpStatus.OK, type: SetupStatusDto })
  async setupStatus() {
    return { needsSetup: await this.auth.needsSetup() };
  }

  /** Creates the owner account (only once) and logs it in. */
  @Public()
  @Post('setup')
  @ZodResponse({
    status: HttpStatus.CREATED,
    type: MeDto,
    description: 'Owner created; sets the session cookie',
  })
  @ApiConflictResponse({ description: 'SETUP_ALREADY_DONE: an owner already exists' })
  async setup(
    @Body() body: SetupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, session } = await this.auth.setup(body.username, body.password, clientInfo(req));
    this.cookie.set(res, session.token, session.expiresAt);
    return user;
  }

  /** Starts a session. Rate limited to 5 attempts per 15 minutes per IP + username. */
  @Public()
  @UseGuards(LoginThrottlerGuard)
  @Post('login')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: `Logged in; sets the ${SESSION_COOKIE} cookie` })
  @ApiUnauthorizedResponse({ description: 'INVALID_CREDENTIALS' })
  @ApiTooManyRequestsResponse({ description: 'RATE_LIMITED: too many attempts' })
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const session = await this.auth.login(body.username, body.password, clientInfo(req));
    this.cookie.set(res, session.token, session.expiresAt);
  }

  /** Ends the current session (deletes it server-side) and clears the cookie. */
  @ApiCookieAuth(SESSION_COOKIE)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Logged out' })
  async logout(
    @CurrentSession() session: AuthSession,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(session.sessionId);
    this.cookie.clear(res);
  }

  /** The logged-in user. */
  @ApiCookieAuth(SESSION_COOKIE)
  @Get('me')
  @ZodResponse({ status: HttpStatus.OK, type: MeDto })
  me(@CurrentSession() session: AuthSession) {
    return this.auth.me(session.userId);
  }
}
