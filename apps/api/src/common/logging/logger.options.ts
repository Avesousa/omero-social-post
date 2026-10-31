import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { type LoggerOptions } from 'pino';
import { type Options as PinoHttpOptions } from 'pino-http';
import type { Env } from '../../config/env.schema';
import { REDACT_PATHS, REDACTED, redactSensitiveKeys, redactUrl } from './redaction';

const HEALTH_PATH = '/api/v1/health';

type LoggerEnv = Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>;

/**
 * pino-http passes serializers an already-serialized `{ id, method, url, headers,
 * remoteAddress }` object, while plain `logger.info({ req })` passes the raw request.
 * These types accept both shapes.
 */
type LoggableReq = Partial<IncomingMessage> & {
  id?: string | number;
  originalUrl?: string;
  remoteAddress?: string;
};
type LoggableRes = Partial<ServerResponse> & { headers?: Record<string, unknown> };

/** Base pino options shared by the HTTP logger and the pre-Nest bootstrap logger. */
export function buildBaseLoggerOptions(env: LoggerEnv): LoggerOptions {
  return {
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: REDACTED },
    formatters: {
      // Runs on the merging object of every log call, before serializers.
      log: (obj) => redactSensitiveKeys(obj),
    },
    serializers: {
      req: (req: LoggableReq) => ({
        id: req.id,
        method: req.method,
        url: redactUrl(req.originalUrl ?? req.url),
        headers: req.headers,
        remoteAddress: req.remoteAddress ?? req.socket?.remoteAddress,
      }),
      res: (res: LoggableRes) => ({
        statusCode: res.statusCode,
        headers: typeof res.getHeaders === 'function' ? res.getHeaders() : res.headers,
      }),
    },
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
      : {}),
  };
}

export function buildPinoHttpOptions(env: LoggerEnv): PinoHttpOptions {
  return {
    ...buildBaseLoggerOptions(env),
    genReqId: (req, res) => {
      const incoming = req.headers['x-request-id'];
      const id =
        typeof incoming === 'string' && /^[\w.-]{1,128}$/.test(incoming) ? incoming : randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    // Docker hits /health every few seconds; keep it out of the logs.
    autoLogging: { ignore: (req) => (req.url ?? '').startsWith(HEALTH_PATH) },
  };
}

export function buildLoggerParams(env: LoggerEnv): Params {
  return { pinoHttp: buildPinoHttpOptions(env) };
}
