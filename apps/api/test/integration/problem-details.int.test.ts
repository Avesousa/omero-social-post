import { Body, Controller, Get, NotFoundException, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ProblemException } from '../../src/common/errors/problem.exception';
import { createTestApp, type TestApp } from '../helpers/app';

class EchoDto extends createZodDto(
  z.object({
    title: z.string().min(1),
    items: z.array(z.object({ text: z.string().max(5) })),
  }),
) {}

@Controller('__test')
class ProbeController {
  @Post('echo')
  echo(@Body() body: EchoDto) {
    return body;
  }

  @Get('conflict')
  conflict() {
    throw ProblemException.conflict('VERSION_CONFLICT', 'The post was modified elsewhere');
  }

  @Get('nest-not-found')
  nestNotFound() {
    throw new NotFoundException('Post not found');
  }

  @Get('boom')
  boom() {
    throw new Error('database password is hunter2');
  }
}

describe('problem+json errors', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ controllers: [ProbeController], env: { WORKERS_ENABLED: 'false' } });
  });
  afterAll(async () => {
    await t?.close();
  });

  it('formats zod validation failures with field paths', async () => {
    const res = await t
      .http()
      .post('/api/v1/__test/echo')
      .send({ title: '', items: [{ text: 'ok' }, { text: 'too long' }] })
      .expect(400)
      .expect('content-type', /application\/problem\+json/);

    expect(res.body).toMatchObject({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      code: 'VALIDATION_FAILED',
      instance: '/api/v1/__test/echo',
    });
    expect(res.body.errors.map((e: { path: string }) => e.path).sort()).toEqual([
      'items[1].text',
      'title',
    ]);
  });

  it('passes valid bodies through the global ZodValidationPipe', async () => {
    const body = { title: 'hi', items: [{ text: 'ok' }] };
    const res = await t.http().post('/api/v1/__test/echo').send(body).expect(201);
    expect(res.body).toEqual(body);
  });

  it('renders ProblemException as given', async () => {
    const res = await t.http().get('/api/v1/__test/conflict').expect(409);
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: 'The post was modified elsewhere',
      instance: '/api/v1/__test/conflict',
      code: 'VERSION_CONFLICT',
      errors: [],
    });
  });

  it('maps Nest HttpExceptions and unknown routes', async () => {
    const thrown = await t.http().get('/api/v1/__test/nest-not-found').expect(404);
    expect(thrown.body).toMatchObject({ code: 'NOT_FOUND', detail: 'Post not found' });

    const missing = await t.http().get('/api/v1/does-not-exist?token=abc').expect(404);
    expect(missing.body).toMatchObject({ code: 'NOT_FOUND', instance: '/api/v1/does-not-exist' });
  });

  it('maps malformed JSON to 400', async () => {
    const res = await t
      .http()
      .post('/api/v1/__test/echo')
      .set('content-type', 'application/json')
      .send('{"title":')
      .expect(400);
    expect(res.body).toMatchObject({ status: 400, code: 'BAD_REQUEST' });
  });

  it('hides internals of unexpected errors', async () => {
    const res = await t.http().get('/api/v1/__test/boom').expect(500);
    expect(res.body).toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
      title: 'Internal Server Error',
    });
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });
});
