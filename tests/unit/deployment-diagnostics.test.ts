import { describe, expect, it } from 'vitest';

import { emptySchemaVerdict, parseDatabaseSteps, rawPasswordBreaksUrl } from '@/server/diagnostics/deployment';

/**
 * Which pasted passwords silently move a MySQL connection somewhere else.
 *
 * Established by measurement against a real server, not from the URL spec:
 * a bare `@` turned out to be harmless, because both WHATWG `URL` and
 * Prisma split credentials on the LAST `@`. The characters that really break
 * the string are the ones that end the authority early.
 */
describe('rawPasswordBreaksUrl', () => {
  const url = (password: string): string =>
    `mysql://u641677794_main_db:${password}@localhost:3306/u641677794_db?connection_limit=5`;

  it('accepts an ordinary password, and the query string after the database', () => {
    expect(rawPasswordBreaksUrl(url('Correct7Horse'))).toBe(false);
  });

  it('accepts a bare @ — both parsers split on the last one', () => {
    expect(rawPasswordBreaksUrl(url('pa@ss'))).toBe(false);
  });

  it('accepts a correctly percent-encoded character', () => {
    expect(rawPasswordBreaksUrl(url('pa%23ss'))).toBe(false);
  });

  it('flags # — it starts a fragment and the host disappears', () => {
    expect(rawPasswordBreaksUrl(url('pa#ss'))).toBe(true);
  });

  it('flags ? — it starts the query string inside the password', () => {
    expect(rawPasswordBreaksUrl(url('pa?ss'))).toBe(true);
  });

  it('flags / — it ends the authority', () => {
    expect(rawPasswordBreaksUrl(url('pa/ss'))).toBe(true);
  });

  it('flags a % that is not an escape', () => {
    expect(rawPasswordBreaksUrl(url('100%sure'))).toBe(true);
  });

  it('does not flag a URL with no password at all', () => {
    expect(rawPasswordBreaksUrl('mysql://user@localhost:3306/db')).toBe(false);
  });
});

/**
 * The build report is the only way to tell, from outside, WHY a reachable
 * database is empty. The first deployment that hit this could not say whether
 * the code predated the self-migrating build or the opt-in was missing.
 */
describe('parseDatabaseSteps', () => {
  it('reads what scripts/build.ts stamps', () => {
    expect(parseDatabaseSteps('{"migrate":"applied","seed":"ran"}')).toEqual({ migrate: 'applied', seed: 'ran' });
  });

  it.each([undefined, '', '   ', 'not json', '[]', '{"migrate":1,"seed":"ran"}', 'null'])(
    'treats %j as "no report"',
    (raw) => {
      expect(parseDatabaseSteps(raw)).toBeNull();
    },
  );
});

describe('emptySchemaVerdict', () => {
  it('names old code when the build left no report', () => {
    expect(emptySchemaVerdict(null)).toMatch(/did not go through scripts\/build\.ts/u);
  });

  it('names the missing opt-in', () => {
    expect(emptySchemaVerdict({ migrate: 'off', seed: 'off' })).toMatch(/BUILD_MIGRATE=true/u);
  });

  it('separates a build that could not reach the database from one that migrated elsewhere', () => {
    expect(emptySchemaVerdict({ migrate: 'unreachable', seed: 'skipped' })).toMatch(/could not reach/u);
    expect(emptySchemaVerdict({ migrate: 'applied', seed: 'ran' })).toMatch(/DIFFERENT database/u);
  });

  it('never recommends a chained build command, which the host cannot express', () => {
    for (const migrate of ['off', 'unreachable', 'no-database-url', 'applied', 'future-value']) {
      expect(emptySchemaVerdict({ migrate, seed: 'off' })).not.toContain('&&');
    }
    expect(emptySchemaVerdict(null)).not.toContain('&&');
  });
});
