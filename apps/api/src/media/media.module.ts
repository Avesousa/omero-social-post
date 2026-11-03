import { Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { LocalDiskStorage } from './storage/local-disk.storage';
import { STORAGE_ADAPTER } from './storage/storage-adapter';

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    {
      // Swap this factory for an S3/R2 adapter later; nothing else depends on local disk.
      provide: STORAGE_ADAPTER,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => new LocalDiskStorage(config.env.MEDIA_DIR),
    },
  ],
  exports: [MediaService, STORAGE_ADAPTER],
})
export class MediaModule {}
