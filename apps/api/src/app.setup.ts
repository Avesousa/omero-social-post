import { type NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { Express, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { API_PREFIX, createOpenApiDocument, OPENAPI_JSON_PATH } from './openapi';
import { BULL_BOARD_ROUTE } from './queues/queue.constants';

const BULL_BOARD_PATH = `/${API_PREFIX}${BULL_BOARD_ROUTE}`;

/**
 * HTTP-level setup shared by `main.ts` and the integration-test app factory, so tests
 * exercise exactly the production middleware stack.
 */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix(API_PREFIX);

  // Requests arrive through the web container's rewrite / Tailscale serve on a private
  // network; trust those hops so `req.ip` is the real client (used by throttling).
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  // The API only serves JSON, so helmet's defaults apply everywhere except Bull
  // Board, an HTML UI that loads its bundles from its base path, Google Fonts, and
  // sets inline styles. Its only inline <script> is JSON data, so scripts stay 'self'.
  const apiHelmet = helmet();
  const boardHelmet = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
      },
    },
  });
  app.use((req: Request, res: Response, next: NextFunction) =>
    req.path.startsWith(BULL_BOARD_PATH) ? boardHelmet(req, res, next) : apiHelmet(req, res, next),
  );
  app.use(cookieParser());

  const document = createOpenApiDocument(app);
  const express = app.getHttpAdapter().getInstance() as Express;
  express.get(OPENAPI_JSON_PATH, (_req: Request, res: Response) => {
    res.json(document);
  });

  app.enableShutdownHooks();
}
