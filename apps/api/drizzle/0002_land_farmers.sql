CREATE TYPE "public"."farmer_flag_type" AS ENUM('duplicate_suspected', 'arrears', 'fraud_suspected');--> statement-breakpoint
CREATE TYPE "public"."farmer_kyc_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."farmer_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."group_member_role" AS ENUM('member', 'president', 'treasurer', 'secretary');--> statement-breakpoint
CREATE TYPE "public"."national_id_type" AS ENUM('cni', 'passport', 'other', 'none');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('F', 'M');--> statement-breakpoint
CREATE TYPE "public"."mobile_wallet_provider" AS ENUM('wave', 'orange_money', 'free_money', 'other', 'none');--> statement-breakpoint
CREATE TYPE "public"."allocation_status" AS ENUM('active', 'ended');--> statement-breakpoint
CREATE TYPE "public"."asset_type" AS ENUM('borehole', 'solar_pump', 'irrigation_network', 'fence', 'storage', 'equipment', 'building', 'other');--> statement-breakpoint
CREATE TYPE "public"."block_status" AS ENUM('draft', 'documenting', 'ready', 'in_financing', 'financed', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."grievance_status" AS ENUM('open', 'in_progress', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."irrigation_type" AS ENUM('none', 'drip', 'sprinkler', 'furrow', 'pivot');--> statement-breakpoint
CREATE TYPE "public"."land_doc_status" AS ENUM('submitted', 'verified', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."land_doc_type" AS ENUM('title_foncier', 'bail', 'deliberation', 'approval_prefect', 'community_agreement', 'cahier_des_charges', 'survey_plan', 'other');--> statement-breakpoint
CREATE TYPE "public"."plot_status" AS ENUM('available', 'allocated', 'fallow', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."solidarity_mode" AS ENUM('none', 'group');--> statement-breakpoint
CREATE TYPE "public"."tenure_type" AS ENUM('title_foncier', 'bail', 'deliberation', 'customary_agreement');--> statement-breakpoint
CREATE TYPE "public"."water_source" AS ENUM('borehole', 'river', 'canal', 'rainfed', 'other');--> statement-breakpoint
CREATE TYPE "public"."sync_op_status" AS ENUM('applied', 'rejected');--> statement-breakpoint
CREATE TABLE "farmer_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"farmer_id" uuid NOT NULL,
	"type" "farmer_flag_type" NOT NULL,
	"detail" text,
	"data" jsonb,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "farmer_group_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"group_org_id" uuid NOT NULL,
	"farmer_id" uuid NOT NULL,
	"role" "group_member_role" DEFAULT 'member' NOT NULL,
	"joined_at" date
);
--> statement-breakpoint
CREATE TABLE "farmers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"owner_org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"sex" "sex" NOT NULL,
	"birth_year" integer,
	"phone" text,
	"locale" text DEFAULT 'fr' NOT NULL,
	"national_id_type" "national_id_type" DEFAULT 'none' NOT NULL,
	"national_id_number_enc" text,
	"national_id_hash" text,
	"national_id_last4" text,
	"photo_file_id" uuid,
	"id_photo_file_id" uuid,
	"village" text,
	"commune" text,
	"home_location" geometry(Point, 4326),
	"household_size" integer,
	"baseline_income_xof" bigint,
	"mobile_wallet_provider" "mobile_wallet_provider" DEFAULT 'none' NOT NULL,
	"mobile_wallet_number_enc" text,
	"mobile_wallet_hash" text,
	"mobile_wallet_last4" text,
	"wallet_verified_at" timestamp with time zone,
	"consent_data_at" timestamp with time zone,
	"consent_credit_bureau_at" timestamp with time zone,
	"consent_text_version" text,
	"kyc_status" "farmer_kyc_status" DEFAULT 'pending' NOT NULL,
	"kyc_verified_by" uuid,
	"kyc_verified_at" timestamp with time zone,
	"status" "farmer_status" DEFAULT 'active' NOT NULL,
	"pseudonymised_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "block_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"block_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"type" "asset_type" NOT NULL,
	"description" text NOT NULL,
	"capex_item_id" uuid,
	"location" geometry(Point, 4326),
	"commissioned_at" date
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"ref" text NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"department" text,
	"commune" text,
	"village" text,
	"boundary" geometry(MultiPolygon, 4326),
	"area_ha" numeric(12, 4),
	"centroid" geometry(Point, 4326),
	"water_source" "water_source" DEFAULT 'rainfed' NOT NULL,
	"irrigation_type" "irrigation_type" DEFAULT 'none' NOT NULL,
	"tenure_type" "tenure_type" NOT NULL,
	"farmer_group_org_id" uuid,
	"solidarity_mode" "solidarity_mode" DEFAULT 'none' NOT NULL,
	"solidarity_cap_pct" numeric(7, 4) DEFAULT '20' NOT NULL,
	"status" "block_status" DEFAULT 'draft' NOT NULL,
	"description" text,
	"archived_at" timestamp with time zone,
	CONSTRAINT "blocks_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "community_grievances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"block_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reporter" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"status" "grievance_status" DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "land_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"block_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"doc_type" "land_doc_type" NOT NULL,
	"number" text,
	"issued_by" text,
	"issue_date" date,
	"expiry_date" date,
	"file_id" uuid NOT NULL,
	"status" "land_doc_status" DEFAULT 'submitted' NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"comment" text
);
--> statement-breakpoint
CREATE TABLE "plot_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"plot_id" uuid NOT NULL,
	"farmer_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"share_pct" numeric(7, 4) DEFAULT '100' NOT NULL,
	"contract_id" uuid,
	"status" "allocation_status" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"block_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"geometry" geometry(Polygon, 4326) NOT NULL,
	"area_ha" numeric(12, 4) NOT NULL,
	"soil_type" text,
	"irrigated" boolean DEFAULT false NOT NULL,
	"status" "plot_status" DEFAULT 'available' NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "field_sync_ops" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"org_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"type" text NOT NULL,
	"user_id" uuid,
	"client_created_at" timestamp with time zone,
	"status" "sync_op_status" NOT NULL,
	"entity_id" uuid,
	"error" jsonb
);
--> statement-breakpoint
ALTER TABLE "farmer_flags" ADD CONSTRAINT "farmer_flags_farmer_id_farmers_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "public"."farmers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farmer_group_members" ADD CONSTRAINT "farmer_group_members_farmer_id_farmers_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "public"."farmers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_assets" ADD CONSTRAINT "block_assets_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_grievances" ADD CONSTRAINT "community_grievances_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "land_documents" ADD CONSTRAINT "land_documents_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_allocations" ADD CONSTRAINT "plot_allocations_plot_id_plots_id_fk" FOREIGN KEY ("plot_id") REFERENCES "public"."plots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_allocations" ADD CONSTRAINT "plot_allocations_farmer_id_farmers_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "public"."farmers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plots" ADD CONSTRAINT "plots_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "farmer_flags_farmer_id_index" ON "farmer_flags" USING btree ("farmer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "farmer_group_members_group_org_id_farmer_id_index" ON "farmer_group_members" USING btree ("group_org_id","farmer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "farmers_owner_org_id_code_index" ON "farmers" USING btree ("owner_org_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "farmers_owner_national_id_uq" ON "farmers" USING btree ("owner_org_id","national_id_hash") WHERE national_id_hash is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "farmers_owner_phone_uq" ON "farmers" USING btree ("owner_org_id","phone") WHERE phone is not null;--> statement-breakpoint
CREATE INDEX "farmers_national_id_hash_index" ON "farmers" USING btree ("national_id_hash");--> statement-breakpoint
CREATE INDEX "farmers_owner_org_id_status_index" ON "farmers" USING btree ("owner_org_id","status");--> statement-breakpoint
CREATE INDEX "farmers_home_gix" ON "farmers" USING gist ("home_location");--> statement-breakpoint
CREATE INDEX "block_assets_block_id_index" ON "block_assets" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "blocks_owner_org_id_status_index" ON "blocks" USING btree ("owner_org_id","status");--> statement-breakpoint
CREATE INDEX "blocks_boundary_gix" ON "blocks" USING gist ("boundary");--> statement-breakpoint
CREATE INDEX "community_grievances_block_id_status_index" ON "community_grievances" USING btree ("block_id","status");--> statement-breakpoint
CREATE INDEX "land_documents_block_id_index" ON "land_documents" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "land_documents_status_index" ON "land_documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "plot_allocations_plot_id_status_index" ON "plot_allocations" USING btree ("plot_id","status");--> statement-breakpoint
CREATE INDEX "plot_allocations_farmer_id_index" ON "plot_allocations" USING btree ("farmer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plot_allocations_active_uq" ON "plot_allocations" USING btree ("plot_id","farmer_id") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "plots_block_code_uq" ON "plots" USING btree ("block_id","code") WHERE archived_at is null;--> statement-breakpoint
CREATE INDEX "plots_block_id_index" ON "plots" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "plots_geometry_gix" ON "plots" USING gist ("geometry");--> statement-breakpoint
CREATE UNIQUE INDEX "field_sync_ops_org_id_client_id_index" ON "field_sync_ops" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX "field_sync_ops_org_id_created_at_index" ON "field_sync_ops" USING btree ("org_id","created_at");