import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@shared/schema";

const connectionString = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "SUPABASE_DATABASE_URL or DATABASE_URL must be set.",
  );
}

// Fail fast on network/database issues so API calls don't hang indefinitely.
const client = postgres(connectionString, {
  prepare: false,
  // postgres.js options are in seconds
  connect_timeout: 10,
  idle_timeout: 20,
  max: 10,
});
export const db = drizzle(client, { schema });
