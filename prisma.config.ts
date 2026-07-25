import path from 'node:path';
import { defineConfig } from 'prisma/config';

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
