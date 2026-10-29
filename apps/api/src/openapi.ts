import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { z } from 'zod';
import { SESSION_COOKIE } from './auth/auth.constants';
import { PROBLEM_CONTENT_TYPE, problemDetailsSchema } from './common/errors/problem-details';

export const API_PREFIX = 'api/v1';
export const OPENAPI_JSON_PATH = `/${API_PREFIX}/openapi.json`;

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head'] as const;

/**
 * Builds the OpenAPI document from controllers + nestjs-zod DTOs. Used both by the
 * running server (`/api/v1/openapi.json`) and `scripts/export-openapi.ts`, which feeds
 * the generated client in `packages/api-client`.
 */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('omero-social-post API')
    .setDescription('Self-hosted social media publisher. Errors use RFC 9457 problem details.')
    .setVersion('v1')
    // Referenced by @ApiCookieAuth(SESSION_COOKIE) on private operations.
    .addCookieAuth(SESSION_COOKIE, { type: 'apiKey', in: 'cookie' }, SESSION_COOKIE)
    .build();
  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
  return withProblemDetails(document);
}

/** Registers the ProblemDetails schema and declares it as every operation's default response. */
function withProblemDetails(document: OpenAPIObject): OpenAPIObject {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(problemDetailsSchema, {
    target: 'openapi-3.0',
  }) as Record<string, unknown>;
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas.ProblemDetails = schema;

  for (const pathItem of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      operation.responses.default ??= {
        description: 'Error (RFC 9457 problem details)',
        content: {
          [PROBLEM_CONTENT_TYPE]: { schema: { $ref: '#/components/schemas/ProblemDetails' } },
        },
      };
    }
  }
  return document;
}
