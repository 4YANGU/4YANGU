# Archived Supabase migrations

This directory preserves historical SQL for reference only. It is outside
`supabase/migrations`, so Supabase does not apply these files automatically.
Do not copy archived files back into the active migration directory or run them
as part of deployment.

## `202609200001_social.sql`

This is the original social inbox migration, preserved byte-for-byte. It shares
version `202609200001` with the current
`../migrations/202609200001_social_repliz.sql` migration. Keeping both files active
caused Supabase Preview to fail when it inserted the duplicate version into
`supabase_migrations.schema_migrations` (`schema_migrations_pkey`, SQLSTATE
`23505`). Only the Repliz migration remains active for this version.

Archiving this file does not alter SQL, renumber migrations, or repair/reset any
database migration history. If Preview reports a further schema or history
mismatch, inspect that error and the applied migration records before making
any migration-history changes.
