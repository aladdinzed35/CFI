import path from 'node:path';
import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

/**
 * Presence of this file makes Prisma skip its own .env loading ("Prisma config
 * detected, skipping environment variable loading"), so DATABASE_URL must be
 * put on the environment here or every CLI command fails with P1012.
 *
 * `process.loadEnvFile` is native in Node 20.6+, which keeps dotenv out of the
 * dependency tree. Existing environment variables win, so CI and Hostinger —
 * which inject real values and ship no .env file — are unaffected.
 */
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

/**
 * Prisma configuration.
 *
 * This replaces the `prisma` key in package.json, which Prisma 6 deprecates and
 * removes in 7 — it emitted a warning on every `prisma generate`, and therefore
 * on every `npm run build` and every Hostinger deploy.
 *
 * `migrations.seed` is what `prisma db seed` invokes. `npm run db:seed` calls
 * the same command directly, so the two entry points cannot drift.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
