import { describe, expect, it } from 'vitest';

import { isEnabled, migrateFailureKind } from '../../scripts/build-policy';

describe('isEnabled', () => {
  it.each(['1', 'true', 'TRUE', ' yes ', 'on'])('reads %j as on', (value) => {
    expect(isEnabled(value)).toBe(true);
  });

  it.each([undefined, '', '0', 'false', 'no', 'off', 'ture'])('reads %j as off', (value) => {
    expect(isEnabled(value)).toBe(false);
  });
});

describe('migrateFailureKind', () => {
  it.each([
    "Error: P1001: Can't reach database server at `localhost:3306`",
    'Error: P1000: Authentication failed against database server at `localhost`',
    'Error: P1003: Database `u1_db` does not exist on the database server',
    'Error: P1013: The provided database string is invalid. invalid port number',
    'Error: P1010: User `u1` was denied access on the database `u1_db`',
    "Access denied for user 'u1'@'localhost' (using password: YES)",
  ])('treats %j as a connection failure', (output) => {
    expect(migrateFailureKind(output)).toBe('connection');
  });

  it.each([
    'Error: P3018\n\nA migration failed to apply. New migrations cannot be applied before the error is recovered from.',
    'Error: P3009\n\nmigrate found failed migrations in the target database',
    'Error: P3005\n\nThe database schema is not empty.',
    'something nobody has seen before',
  ])('treats %j as a migration failure, which stops the build', (output) => {
    expect(migrateFailureKind(output)).toBe('migration');
  });

  it('does not read a longer code that merely starts like a connection code', () => {
    expect(migrateFailureKind('Error: P10011 hypothetical')).toBe('migration');
  });
});
