import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  Redirect,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { CurrentSession, type AuthSession } from '../auth';
import {
  ChannelDto,
  ChannelIdParamDto,
  OAuthCallbackQueryDto,
  ProviderParamDto,
  UpdateChannelDto,
} from './channels.dto';
import { ChannelsService } from './channels.service';

@ApiTags('channels')
@Controller('channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  /** Connected accounts with their status and settings. Tokens are never returned. */
  @Get()
  @ZodResponse({ status: HttpStatus.OK, type: [ChannelDto], description: 'All channels' })
  list() {
    return this.channels.list();
  }

  /**
   * Starts the OAuth flow. The browser navigates here, so it is a GET: answers 302 to the
   * network's consent screen. 409 CHANNEL_NOT_CONFIGURED when its credentials are not set.
   */
  @Get(':provider/connect')
  @Redirect()
  @ApiResponse({ status: HttpStatus.FOUND, description: 'Redirect to the consent screen' })
  async connect(@Param() { provider }: ProviderParamDto, @CurrentSession() session: AuthSession) {
    const url = await this.channels.startConnect(provider, session.sessionId);
    return { url, statusCode: HttpStatus.FOUND };
  }

  /**
   * OAuth redirect target. Always answers 302 back to the app:
   * `/settings/channels?connected=<provider>` on success, `?error=<code>` on failure
   * (see CONNECT_ERROR for the codes).
   */
  @Get(':provider/callback')
  @Redirect()
  @ApiResponse({ status: HttpStatus.FOUND, description: 'Redirect to /settings/channels' })
  async callback(
    @Param() { provider }: ProviderParamDto,
    @Query() query: OAuthCallbackQueryDto,
    @CurrentSession() session: AuthSession,
  ) {
    const url = await this.channels.completeConnect(provider, query, session.sessionId);
    return { url, statusCode: HttpStatus.FOUND };
  }

  /** Updates the per-channel settings (e.g. X long posts). */
  @Patch(':id')
  @ZodResponse({ status: HttpStatus.OK, type: ChannelDto, description: 'The updated channel' })
  update(@Param() { id }: ChannelIdParamDto, @Body() body: UpdateChannelDto) {
    return this.channels.updateSettings(id, body.settings);
  }

  /**
   * Disconnects: deletes the tokens, sets status `disconnected` and flags the channel's
   * pending deliveries. The row stays so post history is intact. Idempotent.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Disconnected' })
  async disconnect(@Param() { id }: ChannelIdParamDto): Promise<void> {
    await this.channels.disconnect(id);
  }
}
