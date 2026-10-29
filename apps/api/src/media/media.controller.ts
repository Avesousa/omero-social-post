import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import { ErrorCode } from '../common/errors/error-codes';
import { ProblemException } from '../common/errors/problem.exception';
import { ACCEPTED_IMAGE_MIMES, ImageRejectedError, MAX_UPLOAD_BYTES } from './image-pipeline';
import { MediaDto, MediaIdParamDto } from './media.dto';
import { MediaService, toMediaView } from './media.service';

/** The part of multer's file object this controller uses (memory storage). */
interface UploadedImage {
  buffer: Buffer;
  size: number;
}

@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /**
   * Uploads one image (multipart field `file`, max 15 MB). The image is sniffed by magic
   * bytes, auto-rotated, stripped of all metadata and re-encoded; identical images
   * return the same media row.
   */
  @Post()
  @UseInterceptors(
    // Memory storage: the pipeline needs the whole file anyway and it is capped at 15 MB.
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: `JPEG, PNG, WebP or static GIF, at most ${MAX_UPLOAD_BYTES} bytes.`,
        },
      },
    },
  })
  @ZodResponse({ status: HttpStatus.CREATED, type: MediaDto, description: 'Stored image' })
  async upload(@UploadedFile() file: UploadedImage | undefined) {
    if (!file) {
      throw ProblemException.badRequest(
        ErrorCode.BAD_REQUEST,
        'Attach the image in the multipart field "file".',
      );
    }
    try {
      return toMediaView(await this.media.upload(file.buffer));
    } catch (err) {
      if (err instanceof ImageRejectedError) {
        const status =
          err.reason === 'too_many_pixels'
            ? HttpStatus.PAYLOAD_TOO_LARGE
            : HttpStatus.UNSUPPORTED_MEDIA_TYPE;
        throw new ProblemException({
          status,
          code:
            status === HttpStatus.PAYLOAD_TOO_LARGE
              ? ErrorCode.PAYLOAD_TOO_LARGE
              : ErrorCode.UNSUPPORTED_MEDIA_TYPE,
          detail: err.message,
        });
      }
      throw err;
    }
  }

  /** Streams a stored image. Immutable: a media id always points at the same bytes. */
  @Get(':id')
  @ApiOkResponse({
    description: 'The image bytes',
    content: Object.fromEntries(
      ACCEPTED_IMAGE_MIMES.map((mime) => [mime, { schema: { type: 'string', format: 'binary' } }]),
    ),
  })
  async get(@Param() { id }: MediaIdParamDto, @Res({ passthrough: true }) res: Response) {
    const file = await this.media.open(id);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(file.stream, {
      type: file.media.mime,
      length: file.size,
      disposition: 'inline',
    });
  }
}
