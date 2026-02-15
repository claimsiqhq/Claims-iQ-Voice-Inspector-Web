# ⚠️ Database Schema Warning

**DO NOT run `npm run db:push`** if you have an existing database with data you want to keep.

The `shared/schema.ts` file in this repo is a **minimal schema** created for the mobile app migration. It does NOT include all the tables in your production database (e.g. `inspection_photos`, `extractions`, `briefings`, `voice_transcripts`, `line_items`, etc.).

Running `db:push` would:
- **DROP** tables not defined in `shared/schema.ts`
- **DELETE** all data in those tables
- Potentially alter column types in existing tables

## Safe options

1. **Do nothing** – If your DB already has `users`, `claims`, `documents`, `standalone_photos`, `scope_line_items`, and `regional_price_sets` with compatible structure, the server should work without any schema changes.

2. **Introspect your DB** – Run `npm run db:pull` to generate a schema from your existing database (saved to a different file). You can then merge any missing pieces into `shared/schema.ts` without dropping tables.

3. **Use migrations** – Use `npm run db:generate` to create migration files, review the SQL, and apply only the changes you want with `npm run db:migrate`.

## If you need to add new tables

Add new table definitions to `shared/schema.ts` and use `db:generate` + `db:migrate` instead of `db:push` so you can review changes before applying them.
