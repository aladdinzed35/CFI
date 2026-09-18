import { describe, expect, it } from 'vitest';

import { rawPasswordBreaksUrl } from '@/server/diagnostics/deployment';

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
