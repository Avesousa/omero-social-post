import { afterAll, afterEach, beforeAll } from 'vitest';
import { onUnhandledFrame, server } from '../msw/server';

beforeAll(() => server.listen({ onUnhandledFrame }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
