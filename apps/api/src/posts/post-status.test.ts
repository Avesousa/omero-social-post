import { describe, expect, it } from 'vitest';
import { type DeliveryStatus } from '../db/schema';
import { derivePostStatus, isDeletable, isEditable } from './post-status';

const of = (...statuses: DeliveryStatus[]) => statuses.map((status) => ({ status }));

describe('derivePostStatus', () => {
  it.each([
    [of('published'), 'published'],
    [of('published', 'published'), 'published'],
    [of('published', 'failed'), 'partially_published'],
    [of('published', 'missed'), 'partially_published'],
    [of('published', 'failed', 'missed'), 'partially_published'],
    [of('failed'), 'failed'],
    [of('failed', 'failed'), 'failed'],
    [of('failed', 'missed'), 'failed'],
    [of('missed'), 'missed'],
    [of('missed', 'missed'), 'missed'],
    [of('publishing'), 'publishing'],
    [of('published', 'publishing'), 'publishing'],
    [of('failed', 'publishing'), 'publishing'],
    [of('published', 'pending'), 'publishing'],
  ] as const)('%j -> %s', (deliveries, expected) => {
    expect(derivePostStatus(deliveries)).toBe(expected);
  });

  it('rejects an empty delivery list', () => {
    expect(() => derivePostStatus([])).toThrow(RangeError);
  });
});

describe('edit and delete rules', () => {
  it('allows edits only for draft and scheduled', () => {
    expect(isEditable('draft')).toBe(true);
    expect(isEditable('scheduled')).toBe(true);
    for (const s of [
      'publishing',
      'published',
      'partially_published',
      'failed',
      'missed',
    ] as const) {
      expect(isEditable(s)).toBe(false);
    }
  });

  it('allows deletes for draft, scheduled, failed and missed', () => {
    for (const s of ['draft', 'scheduled', 'failed', 'missed'] as const) {
      expect(isDeletable(s)).toBe(true);
    }
    for (const s of ['publishing', 'published', 'partially_published'] as const) {
      expect(isDeletable(s)).toBe(false);
    }
  });
});
