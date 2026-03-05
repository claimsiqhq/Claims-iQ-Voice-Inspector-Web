CREATE TABLE IF NOT EXISTS "ms365_oauth_states" (
  "id" serial PRIMARY KEY NOT NULL,
  "state" varchar(64) NOT NULL,
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "ms365_oauth_states_state_unique" UNIQUE("state")
);
