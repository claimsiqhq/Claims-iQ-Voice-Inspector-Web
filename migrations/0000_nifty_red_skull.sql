CREATE TABLE "briefings" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"property_profile" jsonb,
	"coverage_snapshot" jsonb,
	"peril_analysis" jsonb,
	"endorsement_impacts" jsonb,
	"inspection_checklist" jsonb,
	"duties_after_loss" jsonb,
	"red_flags" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_number" varchar(50) NOT NULL,
	"insured_name" text,
	"property_address" text,
	"city" varchar(100),
	"state" varchar(2),
	"zip" varchar(10),
	"date_of_loss" varchar(20),
	"peril_type" varchar(20),
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"assigned_to" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "damage_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"room_id" integer NOT NULL,
	"description" text NOT NULL,
	"damage_type" varchar(50),
	"severity" varchar(20),
	"location" text,
	"measurements" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"document_type" varchar(20) NOT NULL,
	"file_name" text,
	"file_size" integer,
	"storage_path" text,
	"raw_text" text,
	"status" varchar(20) DEFAULT 'empty' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "extractions" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"document_type" varchar(20) NOT NULL,
	"extracted_data" jsonb NOT NULL,
	"confidence" jsonb,
	"confirmed_by_user" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inspection_flows" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar,
	"name" text NOT NULL,
	"peril_type" varchar(30) NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false,
	"is_system_default" boolean DEFAULT false,
	"steps" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inspection_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"room_id" integer,
	"damage_id" integer,
	"storage_path" text,
	"auto_tag" varchar(50),
	"caption" text,
	"photo_type" varchar(30),
	"annotations" jsonb,
	"analysis" jsonb,
	"matches_request" boolean,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inspection_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"room_type" varchar(50),
	"structure" varchar(100) DEFAULT 'Main Dwelling',
	"structure_id" integer,
	"view_type" varchar(20) DEFAULT 'interior',
	"shape_type" varchar(20) DEFAULT 'rectangle',
	"parent_room_id" integer,
	"attachment_type" varchar(30),
	"dimensions" jsonb,
	"polygon" jsonb,
	"position" jsonb,
	"floor" integer DEFAULT 1,
	"facet_label" varchar(10),
	"pitch" varchar(10),
	"status" varchar(20) DEFAULT 'not_started' NOT NULL,
	"damage_count" integer DEFAULT 0,
	"photo_count" integer DEFAULT 0,
	"phase" integer,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "inspection_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"inspector_id" varchar,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"current_phase" integer DEFAULT 1,
	"completed_phases" integer[] DEFAULT '{}',
	"active_flow_id" integer,
	"current_step_index" integer DEFAULT 0,
	"current_room_id" integer,
	"current_structure" varchar(100) DEFAULT 'Main Dwelling',
	"voice_session_id" text,
	"adjuster_notes" text,
	"water_classification" jsonb,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"room_id" integer,
	"damage_id" integer,
	"category" varchar(50) NOT NULL,
	"action" varchar(30),
	"description" text NOT NULL,
	"xact_code" varchar(30),
	"quantity" numeric(12, 2),
	"unit" varchar(20),
	"unit_price" numeric(12, 2),
	"total_price" numeric(12, 2),
	"depreciation_type" varchar(30) DEFAULT 'Recoverable',
	"depreciation_rate" numeric(5, 2),
	"waste_factor" integer,
	"trade_code" varchar(10),
	"coverage_type" varchar(1) DEFAULT 'A',
	"provenance" varchar(20) DEFAULT 'voice',
	"tax_amount" real DEFAULT 0,
	"age" real,
	"life_expectancy" real,
	"depreciation_pct" real,
	"depreciation_amount" real,
	"coverage_bucket" varchar(30) DEFAULT 'Coverage A',
	"quality_grade" varchar(30),
	"apply_o_and_p" boolean DEFAULT false,
	"macro_source" varchar(50),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "moisture_readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"room_id" integer NOT NULL,
	"location" text,
	"reading" real NOT NULL,
	"material_type" varchar(50),
	"dry_standard" real,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "policy_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"coverage_type" varchar(20) NOT NULL,
	"policy_limit" real,
	"deductible" real,
	"apply_roof_schedule" boolean DEFAULT false,
	"roof_schedule_age" real,
	"overhead_pct" real DEFAULT 10,
	"profit_pct" real DEFAULT 10,
	"tax_rate" real DEFAULT 8,
	"op_excluded_trades" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "regional_price_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"region_id" varchar(50) NOT NULL,
	"region_name" text NOT NULL,
	"line_item_code" varchar(30) NOT NULL,
	"material_cost" numeric(12, 2) DEFAULT '0',
	"labor_cost" numeric(12, 2) DEFAULT '0',
	"equipment_cost" numeric(12, 2) DEFAULT '0',
	"effective_date" varchar(20),
	"price_list_version" varchar(20),
	"activity_type" varchar(20),
	"labor_formula" text,
	"material_formula" text,
	"equipment_formula" text
);
--> statement-breakpoint
CREATE TABLE "room_adjacencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"room_id_a" integer NOT NULL,
	"room_id_b" integer NOT NULL,
	"wall_direction_a" varchar(20),
	"wall_direction_b" varchar(20),
	"shared_wall_length_ft" real,
	"opening_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "room_openings" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer,
	"room_id" integer NOT NULL,
	"opening_type" varchar(30) DEFAULT 'door' NOT NULL,
	"wall_index" integer,
	"wall_direction" varchar(20),
	"position_on_wall" real DEFAULT 0.5,
	"width_ft" real,
	"height_ft" real,
	"width" real,
	"height" real,
	"quantity" integer DEFAULT 1 NOT NULL,
	"label" varchar(50),
	"opens_into" varchar(100),
	"goes_to_floor" boolean DEFAULT false,
	"goes_to_ceiling" boolean DEFAULT false,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scope_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"room_id" integer,
	"damage_id" integer,
	"catalog_code" varchar(30),
	"description" text NOT NULL,
	"trade_code" varchar(10) NOT NULL,
	"quantity" real NOT NULL,
	"unit" varchar(10) NOT NULL,
	"quantity_formula" varchar(50),
	"provenance" varchar(30) DEFAULT 'voice_command' NOT NULL,
	"coverage_type" varchar(1) DEFAULT 'A',
	"activity_type" varchar(20) DEFAULT 'replace',
	"waste_factor" real,
	"status" varchar(20) DEFAULT 'active',
	"parent_scope_item_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scope_line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(30) NOT NULL,
	"description" text NOT NULL,
	"unit" varchar(10) NOT NULL,
	"trade_code" varchar(10) NOT NULL,
	"quantity_formula" varchar(50),
	"default_waste_factor" real DEFAULT 0,
	"activity_type" varchar(20) DEFAULT 'replace',
	"coverage_type" varchar(1) DEFAULT 'A',
	"scope_conditions" jsonb,
	"companion_rules" jsonb,
	"xact_category_code" varchar(10),
	"xact_selector" varchar(20),
	"xact_item_id" varchar(20),
	"xact_description" text,
	"xact_includes" text,
	"xact_excludes" text,
	"xact_quality_spec" text,
	"xact_notes" text,
	"is_taxable" boolean DEFAULT true,
	"tax_rate" real,
	"xact_phase" varchar(10),
	"xact_minimum_id" varchar(10),
	"notes" text,
	"sort_order" integer DEFAULT 0,
	"op_eligible_default" boolean DEFAULT true,
	"is_code_upgrade" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	CONSTRAINT "scope_line_items_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "scope_summary" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"trade_code" varchar(10) NOT NULL,
	"trade_name" varchar(100),
	"item_count" integer DEFAULT 0,
	"quantities_by_unit" jsonb,
	"total_material" real DEFAULT 0,
	"total_labor" real DEFAULT 0,
	"total_equipment" real DEFAULT 0,
	"total_tax" real DEFAULT 0,
	"total_rcv" real DEFAULT 0,
	"total_depreciation" real DEFAULT 0,
	"total_acv" real DEFAULT 0,
	"op_eligible" boolean DEFAULT true,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scope_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(10) NOT NULL,
	"name" varchar(100) NOT NULL,
	"xact_category_prefix" varchar(10),
	"op_eligible" boolean DEFAULT true,
	"sort_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	CONSTRAINT "scope_trades_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sketch_annotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"room_id" integer NOT NULL,
	"annotation_type" varchar(30) NOT NULL,
	"label" varchar(100) NOT NULL,
	"value" varchar(50),
	"location" varchar(100),
	"position" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sketch_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"category" varchar(30) NOT NULL,
	"description" text,
	"polygon" jsonb NOT NULL,
	"default_dimensions" jsonb,
	"openings" jsonb,
	"room_type" varchar(50),
	"thumbnail_svg" text,
	"is_active" boolean DEFAULT true,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "standalone_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"claim_id" integer,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer,
	"source" varchar(30) DEFAULT 'upload',
	"analysis_status" varchar(20) DEFAULT 'pending',
	"analysis" jsonb,
	"annotations" jsonb,
	"severity_score" real,
	"damage_types" jsonb DEFAULT '[]'::jsonb,
	"suggested_repairs" jsonb DEFAULT '[]'::jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "structures" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"structure_type" varchar(30) DEFAULT 'dwelling' NOT NULL,
	"outline" jsonb,
	"position" jsonb,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "supplemental_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"original_session_id" integer NOT NULL,
	"claim_id" integer NOT NULL,
	"reason" text NOT NULL,
	"status" varchar(20) DEFAULT 'draft',
	"new_line_items" jsonb,
	"removed_line_item_ids" jsonb,
	"modified_line_items" jsonb,
	"review_notes" text,
	"created_at" timestamp DEFAULT now(),
	"submitted_at" timestamp,
	"approved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tax_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"tax_label" varchar(50) NOT NULL,
	"tax_rate" real NOT NULL,
	"applies_to_categories" jsonb DEFAULT '[]'::jsonb,
	"applies_to_cost_type" varchar(20) DEFAULT 'material',
	"is_default" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "test_squares" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"room_id" integer,
	"hail_hits" integer DEFAULT 0 NOT NULL,
	"wind_creases" integer DEFAULT 0,
	"pitch" varchar(10) NOT NULL,
	"result" varchar(30) DEFAULT 'pass' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"email" text,
	"full_name" text,
	"role" varchar(20) DEFAULT 'adjuster' NOT NULL,
	"title" text,
	"avatar_url" text,
	"supabase_auth_id" varchar(100),
	"last_login_at" timestamp,
	"is_active" boolean DEFAULT true,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_supabase_auth_id_unique" UNIQUE("supabase_auth_id")
);
--> statement-breakpoint
CREATE TABLE "voice_transcripts" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"speaker" varchar(10) NOT NULL,
	"content" text NOT NULL,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "xact_price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"xact_name" varchar(50) NOT NULL,
	"region_description" text,
	"effective_date" varchar(30),
	"xact_version" integer,
	"item_count" integer,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "xact_price_lists_xact_name_unique" UNIQUE("xact_name")
);
--> statement-breakpoint
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_observations" ADD CONSTRAINT "damage_observations_session_id_inspection_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."inspection_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_observations" ADD CONSTRAINT "damage_observations_room_id_inspection_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."inspection_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_flows" ADD CONSTRAINT "inspection_flows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_session_id_inspection_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."inspection_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_room_id_inspection_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."inspection_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_damage_id_damage_observations_id_fk" FOREIGN KEY ("damage_id") REFERENCES "public"."damage_observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_rooms" ADD CONSTRAINT "inspection_rooms_session_id_inspection_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."inspection_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_rooms" ADD CONSTRAINT "inspection_rooms_structure_id_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."structures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_rooms" ADD CONSTRAINT "inspection_rooms_parent_room_id_inspection_rooms_id_fk" FOREIGN KEY ("parent_room_id") REFERENCES "public"."inspection_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_sessions" ADD CONSTRAINT "inspection_sessions_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_sessions" ADD CONSTRAINT "inspection_sessions_inspector_id_users_id_fk" FOREIGN KEY ("inspector_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_session_id_inspection_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."inspection_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_room_id_inspection_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."inspection_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_damage_id_damage_observations_id_fk" FOREIGN KEY ("damage_id") REFERENCES "public"."damage_observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moisture_readings" ADD CONSTRAINT "moisture_readings_session_id_inspection_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."inspection_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moisture_readings" ADD CONSTRAINT "moisture_readings_room_id_inspection_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."inspection_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_rules" ADD CONSTRAINT "policy_rules_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_adjacencies" ADD CONSTRAINT "room_adjacencies_session_id_inspection_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."inspection_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_adjacencies" ADD CONSTRAINT "room_adjacencies_room_id_a_inspection_rooms_id_fk" FOREIGN KEY ("room_id_a") REFERENCES "public"."inspection_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_adjacencies" ADD CONSTRAINT "room_adjacencies_room_id_b_inspection_rooms_id_fk" FOREIGN KEY ("room_id_b") REFERENCES "public"."inspection_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_adjacencies" ADD CONSTRAINT "room_adjacencies_opening_id_room_openings_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."room_openings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_openings" ADD CONSTRAINT "room_openings_session_id_inspection_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."inspection_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_openings" ADD CONSTRAINT "room_openings_room_id_inspection_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."inspection_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_items" ADD CONSTRAINT "scope_items_session_id_inspection_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."inspection_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_items" ADD CONSTRAINT "scope_items_room_id_inspection_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."inspection_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_items" ADD CONSTRAINT "scope_items_damage_id_damage_observations_id_fk" FOREIGN KEY ("damage_id") REFERENCES "public"."damage_observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_items" ADD CONSTRAINT "scope_items_catalog_code_scope_line_items_code_fk" FOREIGN KEY ("catalog_code") REFERENCES "public"."scope_line_items"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_summary" ADD CONSTRAINT "scope_summary_session_id_inspection_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."inspection_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sketch_annotations" ADD CONSTRAINT "sketch_annotations_room_id_inspection_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."inspection_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standalone_photos" ADD CONSTRAINT "standalone_photos_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structures" ADD CONSTRAINT "structures_session_id_inspection_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."inspection_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplemental_claims" ADD CONSTRAINT "supplemental_claims_original_session_id_inspection_sessions_id_fk" FOREIGN KEY ("original_session_id") REFERENCES "public"."inspection_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplemental_claims" ADD CONSTRAINT "supplemental_claims_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_squares" ADD CONSTRAINT "test_squares_session_id_inspection_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."inspection_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_squares" ADD CONSTRAINT "test_squares_room_id_inspection_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."inspection_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_transcripts" ADD CONSTRAINT "voice_transcripts_session_id_inspection_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."inspection_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claims_claim_number_unique" ON "claims" USING btree ("claim_number");--> statement-breakpoint
CREATE INDEX "claims_assigned_to_idx" ON "claims" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "claims_status_idx" ON "claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "damage_observations_session_id_idx" ON "damage_observations" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "damage_observations_room_id_idx" ON "damage_observations" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_claim_document_unique" ON "documents" USING btree ("claim_id","document_type");--> statement-breakpoint
CREATE UNIQUE INDEX "extractions_claim_document_unique" ON "extractions" USING btree ("claim_id","document_type");--> statement-breakpoint
CREATE INDEX "inspection_photos_session_id_idx" ON "inspection_photos" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "inspection_photos_room_id_idx" ON "inspection_photos" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "inspection_rooms_session_id_idx" ON "inspection_rooms" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "inspection_rooms_structure_id_idx" ON "inspection_rooms" USING btree ("structure_id");--> statement-breakpoint
CREATE INDEX "inspection_sessions_claim_id_idx" ON "inspection_sessions" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "line_items_session_id_idx" ON "line_items" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "line_items_room_id_idx" ON "line_items" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scope_line_items_xact_cat_sel_unique" ON "scope_line_items" USING btree ("xact_category_code","xact_selector");--> statement-breakpoint
CREATE INDEX "standalone_photos_user_id_idx" ON "standalone_photos" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "standalone_photos_claim_id_idx" ON "standalone_photos" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "structures_session_name_unique" ON "structures" USING btree ("session_id","name");