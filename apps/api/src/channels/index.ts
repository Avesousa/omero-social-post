// Public surface of the channels module for other domain modules.
export { CONNECT_ERROR, type ConnectError } from './channel-errors';
export { ChannelsModule } from './channels.module';
export { ChannelsService } from './channels.service';
export { REFRESH_WINDOW_MS, TokenService, type ValidChannelContext } from './token.service';
