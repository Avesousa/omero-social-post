import { describe, expect, it } from 'vitest';
import { MaintenanceProcessor } from '../../src/queues/processors/maintenance.processor';
import { QUEUE, QUEUE_NAMES } from '../../src/queues/queue.constants';
import { createTestApp } from '../helpers/app';
import { getQueue } from '../helpers/jobs';

describe('WORKERS_ENABLED', () => {
  it('registers processors and starts their workers when true', async () => {
    const t = await createTestApp({ env: { WORKERS_ENABLED: 'true' } });
    try {
      const processor = t.app.get(MaintenanceProcessor, { strict: false });
      expect(processor.worker.isRunning()).toBe(true);
    } finally {
      await t.close();
    }
  });

  it('registers no processor when false, while queues stay injectable for producers', async () => {
    const t = await createTestApp({ env: { WORKERS_ENABLED: 'false' } });
    try {
      expect(() => t.app.get(MaintenanceProcessor, { strict: false })).toThrow();
      for (const name of QUEUE_NAMES) {
        expect(getQueue(t.app, name).name).toBe(name);
      }
      const job = await getQueue(t.app, QUEUE.maintenance).add('noop', {});
      expect(await job.getState()).toBe('waiting');
      await job.remove();
    } finally {
      await t.close();
    }
  });

  it('lists the four queues in Bull Board', async () => {
    const t = await createTestApp({ env: { WORKERS_ENABLED: 'false' } });
    try {
      const res = await t.http().get('/api/v1/admin/queues/api/queues').expect(200);
      const names = (res.body.queues as Array<{ name: string }>).map((q) => q.name).sort();
      expect(names).toEqual(['maintenance', 'metrics', 'notify', 'publish']);
    } finally {
      await t.close();
    }
  });
});
