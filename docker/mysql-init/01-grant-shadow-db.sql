-- `prisma migrate dev` creates and drops a throwaway "shadow database" to
-- detect schema drift, which needs privileges beyond the app's own schema.
-- Without this, every migrate dev fails with P3014 / P1010.
--
-- Scoped to the local development container only. In production the app user
-- holds no such rights: deploys run `prisma migrate deploy`, which replays
-- already-generated SQL and never needs a shadow database.
GRANT ALL PRIVILEGES ON *.* TO 'cfi'@'%';
FLUSH PRIVILEGES;
