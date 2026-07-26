-- §17.2 duplicate detection runs on every open of the admin review drawer:
--   findDuplicates() → WHERE phone = ?            (queries.ts:399)
--                    → WHERE fullName = ? AND city = ?  (queries.ts:407-410)
-- Neither column was indexed. The @@fulltext([fullName, email, phone]) index
-- cannot serve an equality predicate, so both queries were full table scans on
-- the single busiest screen an administrator uses.

-- CreateIndex
CREATE INDEX `User_phone_idx` ON `User`(`phone`);

-- CreateIndex
CREATE INDEX `User_fullName_city_idx` ON `User`(`fullName`, `city`);
