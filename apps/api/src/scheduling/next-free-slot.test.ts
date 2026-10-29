import { describe, expect, it } from 'vitest';
import { nextFreeSlot, type WeeklySlot } from './next-free-slot';

// Weekdays follow JS Date#getDay: 0 = Sunday ... 6 = Saturday.
const SUN = 0;
const MON = 1;
const WED = 3;
const THU = 4;
const FRI = 5;

const slot = (weekday: number, localTime: string, enabled = true): WeeklySlot => ({
  weekday,
  localTime,
  enabled,
});
const weekdays = (localTime: string) => [MON, 2, WED, THU, FRI].map((d) => slot(d, localTime));
const at = (iso: string) => new Date(iso);

/** Runs nextFreeSlot and returns its ISO string (or null) for compact assertions. */
function next(
  timezone: string,
  now: string,
  slots: WeeklySlot[],
  takenTimes: string[] = [],
  horizonDays?: number,
): string | null {
  return (
    nextFreeSlot({
      now: at(now),
      timezone,
      slots,
      takenTimes: takenTimes.map(at),
      horizonDays,
    })?.toISOString() ?? null
  );
}

describe('nextFreeSlot', () => {
  describe('weekly walk', () => {
    it('returns a slot later the same day', () => {
      // 2026-10-28 is a Wednesday.
      expect(next('UTC', '2026-10-28T08:00:00Z', weekdays('09:00'))).toBe(
        '2026-10-28T09:00:00.000Z',
      );
    });

    it('wraps from Saturday to Monday', () => {
      expect(next('UTC', '2026-10-31T10:00:00Z', weekdays('09:00'))).toBe(
        '2026-11-02T09:00:00.000Z',
      );
    });

    it('wraps from Friday after the last slot to Monday', () => {
      expect(next('UTC', '2026-10-30T18:30:00Z', [...weekdays('09:00'), slot(FRI, '18:00')])).toBe(
        '2026-11-02T09:00:00.000Z',
      );
    });

    it('wraps across the week from Sunday back to the same weekday', () => {
      // Only slot is Wednesday 09:00 and it already passed today.
      expect(next('UTC', '2026-10-28T09:30:00Z', [slot(WED, '09:00')])).toBe(
        '2026-11-04T09:00:00.000Z',
      );
    });

    it('never returns the current instant or the past', () => {
      expect(next('UTC', '2026-10-28T09:00:00Z', [slot(WED, '09:00'), slot(WED, '18:00')])).toBe(
        '2026-10-28T18:00:00.000Z',
      );
    });

    it('picks the earliest slot of the day regardless of input order', () => {
      expect(
        next('UTC', '2026-10-28T06:00:00Z', [
          slot(WED, '18:00'),
          slot(WED, '07:15'),
          slot(WED, '12:00'),
        ]),
      ).toBe('2026-10-28T07:15:00.000Z');
    });

    it('accepts HH:mm:ss times as stored by Postgres', () => {
      expect(next('UTC', '2026-10-28T08:00:00Z', [slot(WED, '09:30:00')])).toBe(
        '2026-10-28T09:30:00.000Z',
      );
    });
  });

  describe('occupied slots', () => {
    const slots = [...weekdays('09:00'), ...weekdays('18:00')];

    it('skips a taken slot', () => {
      expect(next('UTC', '2026-10-28T08:00:00Z', slots, ['2026-10-28T09:00:00Z'])).toBe(
        '2026-10-28T18:00:00.000Z',
      );
    });

    it('skips several taken slots in a row, across days', () => {
      expect(
        next('UTC', '2026-10-28T08:00:00Z', slots, [
          '2026-10-28T09:00:00Z',
          '2026-10-28T18:00:00Z',
          '2026-10-29T09:00:00Z',
        ]),
      ).toBe('2026-10-29T18:00:00.000Z');
    });

    it('matches taken times on the minute (seconds are ignored)', () => {
      expect(next('UTC', '2026-10-28T08:00:00Z', slots, ['2026-10-28T09:00:42.123Z'])).toBe(
        '2026-10-28T18:00:00.000Z',
      );
    });

    it('does not treat a post at a different minute as taking the slot', () => {
      expect(next('UTC', '2026-10-28T08:00:00Z', slots, ['2026-10-28T09:01:00Z'])).toBe(
        '2026-10-28T09:00:00.000Z',
      );
    });
  });

  describe('no free slot', () => {
    it('returns null when every slot in the next 30 days is taken', () => {
      // Wednesdays after now (Wed 2026-10-28 10:00) within 30 days: Nov 4, 11, 18, 25.
      const taken = ['2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25'].map(
        (d) => `${d}T09:00:00Z`,
      );
      expect(next('UTC', '2026-10-28T10:00:00Z', [slot(WED, '09:00')], taken)).toBeNull();
    });

    it('does not look beyond the horizon', () => {
      // Dec 2 is the next Wednesday after the taken ones, but it is 35 days away.
      const taken = ['2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25'].map(
        (d) => `${d}T09:00:00Z`,
      );
      expect(next('UTC', '2026-10-28T10:00:00Z', [slot(WED, '09:00')], taken, 40)).toBe(
        '2026-12-02T09:00:00.000Z',
      );
      expect(next('UTC', '2026-10-28T10:00:00Z', [slot(WED, '09:00')], [], 5)).toBeNull();
    });

    it('returns null with no slots', () => {
      expect(next('UTC', '2026-10-28T10:00:00Z', [])).toBeNull();
    });
  });

  describe('disabled slots', () => {
    it('ignores a disabled slot', () => {
      expect(
        next('UTC', '2026-10-28T08:00:00Z', [slot(WED, '09:00', false), slot(WED, '18:00')]),
      ).toBe('2026-10-28T18:00:00.000Z');
    });

    it('returns null when every slot is disabled', () => {
      expect(next('UTC', '2026-10-28T08:00:00Z', [slot(WED, '09:00', false)])).toBeNull();
    });
  });

  describe('timezones far from UTC', () => {
    it('America/Argentina/Buenos_Aires (UTC-3): a local evening slot lands on the next UTC day', () => {
      // Now is Wed 20:30 local (23:30Z); Wed 21:00 local is Thu 00:00Z.
      expect(
        next('America/Argentina/Buenos_Aires', '2026-10-28T23:30:00Z', [slot(WED, '21:00')]),
      ).toBe('2026-10-29T00:00:00.000Z');
    });

    it('America/Argentina/Buenos_Aires: uses the local weekday, not the UTC one', () => {
      // 01:00Z Thursday is still Wednesday 22:00 in Buenos Aires.
      expect(
        next('America/Argentina/Buenos_Aires', '2026-10-29T01:00:00Z', [
          slot(WED, '23:00'),
          slot(THU, '09:00'),
        ]),
      ).toBe('2026-10-29T02:00:00.000Z');
    });

    it('Pacific/Auckland (UTC+13 in October): the local Thursday starts on UTC Wednesday', () => {
      // 10:00Z Wed = Wed 23:00 NZDT. Thu 08:00 NZDT = Wed 19:00Z.
      expect(
        next('Pacific/Auckland', '2026-10-28T10:00:00Z', [slot(WED, '08:00'), slot(THU, '08:00')]),
      ).toBe('2026-10-28T19:00:00.000Z');
    });

    it('Pacific/Auckland: a local slot that passed today moves to next week', () => {
      expect(next('Pacific/Auckland', '2026-10-28T10:00:00Z', [slot(WED, '08:00')])).toBe(
        '2026-11-03T19:00:00.000Z',
      );
    });

    it('Asia/Kolkata (UTC+5:30): handles half-hour offsets', () => {
      // 03:00Z = 08:30 IST. Wed 09:00 IST = 03:30Z.
      expect(next('Asia/Kolkata', '2026-10-28T03:00:00Z', [slot(WED, '09:00')])).toBe(
        '2026-10-28T03:30:00.000Z',
      );
    });

    it('Asia/Kolkata: a taken slot is skipped at the right instant', () => {
      expect(
        next(
          'Asia/Kolkata',
          '2026-10-28T03:00:00Z',
          [slot(WED, '09:00'), slot(WED, '18:00')],
          ['2026-10-28T03:30:00Z'],
        ),
      ).toBe('2026-10-28T12:30:00.000Z');
    });
  });

  describe('DST in America/New_York', () => {
    const tz = 'America/New_York';

    describe('spring forward (Sun 2026-03-08, 02:00 EST -> 03:00 EDT)', () => {
      it('keeps a 09:00 slot at 09:00 local after the change (13:00Z instead of 14:00Z)', () => {
        expect(next(tz, '2026-03-01T15:00:00Z', [slot(MON, '09:00')])).toBe(
          '2026-03-02T14:00:00.000Z',
        );
        expect(next(tz, '2026-03-06T15:00:00Z', [slot(MON, '09:00')])).toBe(
          '2026-03-09T13:00:00.000Z',
        );
      });

      it('keeps a slot on the transition day itself at its local time', () => {
        expect(next(tz, '2026-03-07T12:00:00Z', [slot(SUN, '09:00')])).toBe(
          '2026-03-08T13:00:00.000Z',
        );
      });

      it('moves a slot inside the gap (02:30) forward to 03:00 EDT', () => {
        expect(next(tz, '2026-03-07T12:00:00Z', [slot(SUN, '02:30')])).toBe(
          '2026-03-08T07:00:00.000Z',
        );
      });

      it('treats the gap-resolved instant as taken like any other', () => {
        expect(
          next(tz, '2026-03-07T12:00:00Z', [slot(SUN, '02:30')], ['2026-03-08T07:00:00Z']),
        ).toBe('2026-03-15T06:30:00.000Z');
      });
    });

    describe('fall back (Sun 2026-11-01, 02:00 EDT -> 01:00 EST)', () => {
      it('keeps a 09:00 slot at 09:00 local after the change (14:00Z instead of 13:00Z)', () => {
        expect(next(tz, '2026-10-24T12:00:00Z', [slot(SUN, '09:00')])).toBe(
          '2026-10-25T13:00:00.000Z',
        );
        expect(next(tz, '2026-10-31T12:00:00Z', [slot(SUN, '09:00')])).toBe(
          '2026-11-01T14:00:00.000Z',
        );
      });

      it('uses the first occurrence of an ambiguous time (01:30 EDT)', () => {
        expect(next(tz, '2026-10-31T12:00:00Z', [slot(SUN, '01:30')])).toBe(
          '2026-11-01T05:30:00.000Z',
        );
      });

      it('does not use the second occurrence once the first has passed', () => {
        // 05:45Z = 01:45 EDT, between the two 01:30s.
        expect(next(tz, '2026-11-01T05:45:00Z', [slot(SUN, '01:30')])).toBe(
          '2026-11-08T06:30:00.000Z',
        );
      });
    });
  });

  describe('DST in Europe/Madrid', () => {
    const tz = 'Europe/Madrid';

    describe('spring forward (Sun 2026-03-29, 02:00 CET -> 03:00 CEST)', () => {
      it('keeps a 10:00 slot at 10:00 local (09:00Z before, 08:00Z after)', () => {
        expect(next(tz, '2026-03-21T12:00:00Z', [slot(SUN, '10:00')])).toBe(
          '2026-03-22T09:00:00.000Z',
        );
        expect(next(tz, '2026-03-28T12:00:00Z', [slot(SUN, '10:00')])).toBe(
          '2026-03-29T08:00:00.000Z',
        );
      });

      it('moves a slot inside the gap (02:30) forward to 03:00 CEST', () => {
        expect(next(tz, '2026-03-28T12:00:00Z', [slot(SUN, '02:30')])).toBe(
          '2026-03-29T01:00:00.000Z',
        );
      });
    });

    describe('fall back (Sun 2026-10-25, 03:00 CEST -> 02:00 CET)', () => {
      it('keeps a 10:00 slot at 10:00 local (08:00Z before, 09:00Z after)', () => {
        expect(next(tz, '2026-10-17T12:00:00Z', [slot(SUN, '10:00')])).toBe(
          '2026-10-18T08:00:00.000Z',
        );
        expect(next(tz, '2026-10-24T12:00:00Z', [slot(SUN, '10:00')])).toBe(
          '2026-10-25T09:00:00.000Z',
        );
      });

      it('uses the first occurrence of an ambiguous time (02:30 CEST)', () => {
        expect(next(tz, '2026-10-24T12:00:00Z', [slot(SUN, '02:30')])).toBe(
          '2026-10-25T00:30:00.000Z',
        );
      });
    });
  });

  it('rejects an unknown time zone', () => {
    expect(() => next('Mars/Olympus_Mons', '2026-10-28T08:00:00Z', [slot(WED, '09:00')])).toThrow(
      RangeError,
    );
  });
});
