CREATE TYPE "public"."crop_category" AS ENUM('cereal', 'vegetable', 'legume', 'root', 'fruit', 'oilseed', 'other');--> statement-breakpoint
CREATE TYPE "public"."service_kind" AS ENUM('seed', 'fertiliser', 'crop_protection', 'mechanisation', 'irrigation_opex', 'labour', 'training', 'transport', 'storage', 'insurance_premium', 'land_fee', 'operator_service_fee', 'investment_recovery_fee', 'platform_fee', 'other');--> statement-breakpoint
CREATE TYPE "public"."service_unit" AS ENUM('kg', 'l', 'ha', 'hour', 'day', 'unit', 'season', 'bag');--> statement-breakpoint
CREATE TYPE "public"."budget_payer" AS ENUM('farmer_credit', 'farmer_cash', 'operator', 'grant');--> statement-breakpoint
CREATE TYPE "public"."budget_scope" AS ENUM('block', 'plot', 'per_ha_all', 'per_ha_crop');--> statement-breakpoint
CREATE TYPE "public"."budget_tranche" AS ENUM('seasonal', 'none');--> statement-breakpoint
CREATE TYPE "public"."capex_tranche" AS ENUM('investment', 'equity', 'grant');--> statement-breakpoint
CREATE TYPE "public"."opex_kind" AS ENUM('staff', 'fuel', 'maintenance', 'security', 'insurance', 'admin', 'other');--> statement-breakpoint
CREATE TYPE "public"."season_kind" AS ENUM('rainy', 'cold_dry', 'hot_dry');--> statement-breakpoint
CREATE TYPE "public"."season_status" AS ENUM('planning', 'financing', 'in_progress', 'harvest', 'settlement', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."offtake_status" AS ENUM('draft', 'loi', 'signed', 'terminated', 'expired');--> statement-breakpoint
CREATE TYPE "public"."price_type" AS ENUM('fixed', 'floor_plus_market', 'formula');--> statement-breakpoint
CREATE TABLE "crop_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"owner_org_id" uuid,
	"base_template_id" uuid,
	"crop_id" uuid NOT NULL,
	"variety_id" uuid,
	"zone" text NOT NULL,
	"irrigated" boolean NOT NULL,
	"cycle_days" integer NOT NULL,
	"yield_base_t_ha" numeric(10, 3) NOT NULL,
	"yield_stress_t_ha" numeric(10, 3) NOT NULL,
	"post_harvest_loss_pct" numeric(7, 4) NOT NULL,
	"delivery_rate_pct" numeric(7, 4) DEFAULT '95' NOT NULL,
	"water_m_3_ha" numeric(12, 2),
	"labour_days_ha" numeric(10, 2),
	"inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "crop_varieties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"crop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"cycle_days" integer
);
--> statement-breakpoint
CREATE TABLE "crops" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"code" text NOT NULL,
	"name_fr" text NOT NULL,
	"name_en" text NOT NULL,
	"category" "crop_category" NOT NULL,
	"perishable" boolean DEFAULT false NOT NULL,
	CONSTRAINT "crops_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "market_prices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"crop_id" uuid NOT NULL,
	"market" text NOT NULL,
	"date" date NOT NULL,
	"price_xof_per_kg" bigint NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_catalog" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"owner_org_id" uuid,
	"code" text NOT NULL,
	"name_fr" text NOT NULL,
	"name_en" text NOT NULL,
	"kind" "service_kind" NOT NULL,
	"unit" "service_unit" NOT NULL,
	"default_unit_price_xof" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"region_list" text[] NOT NULL,
	CONSTRAINT "zones_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"season_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"scope" "budget_scope" NOT NULL,
	"plot_id" uuid,
	"crop_id" uuid,
	"service_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"unit" "service_unit" NOT NULL,
	"unit_price_xof" bigint NOT NULL,
	"quote_id" uuid,
	"payer" "budget_payer" NOT NULL,
	"tranche" "budget_tranche" DEFAULT 'none' NOT NULL,
	"planned_date" date,
	"notes" text,
	"source" text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capex_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"block_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"description" text NOT NULL,
	"asset_type" text NOT NULL,
	"amount_xof" bigint NOT NULL,
	"useful_life_years" integer NOT NULL,
	"quote_id" uuid,
	"tranche" "capex_tranche" NOT NULL,
	"planned_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"block_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"operator_service_fee_xof_per_farmer_season" bigint NOT NULL,
	"land_fee_xof_per_ha_season" bigint NOT NULL,
	"investment_recovery_fee_xof_per_ha_season" bigint NOT NULL,
	"effective_from" date NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "operator_opex" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"block_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"description" text NOT NULL,
	"kind" "opex_kind" NOT NULL,
	"amount_xof_per_month" bigint NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date
);
--> statement-breakpoint
CREATE TABLE "plantings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"season_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"plot_id" uuid NOT NULL,
	"crop_id" uuid NOT NULL,
	"variety_id" uuid,
	"template_id" uuid,
	"area_ha" numeric(12, 4) NOT NULL,
	"planned_sowing_date" date,
	"planned_harvest_date" date,
	"yield_base_t_ha" numeric(10, 3),
	"yield_stress_t_ha" numeric(10, 3),
	"post_harvest_loss_pct" numeric(7, 4),
	"delivery_rate_pct" numeric(7, 4),
	"price_xof_per_kg_base" bigint,
	"price_xof_per_kg_stress" bigint
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"block_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "season_kind" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "season_status" DEFAULT 'planning' NOT NULL,
	"plan_version" integer DEFAULT 1 NOT NULL,
	"self_financed" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "supplier_quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"owner_org_id" uuid NOT NULL,
	"supplier_org_id" uuid,
	"supplier_name" text NOT NULL,
	"service_id" uuid NOT NULL,
	"unit" "service_unit" NOT NULL,
	"unit_price_xof" bigint NOT NULL,
	"min_qty" numeric(14, 3),
	"valid_until" date NOT NULL,
	"file_id" uuid,
	"private" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offtake_contracts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"ref" text NOT NULL,
	"block_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"season_id" uuid,
	"buyer_org_id" uuid NOT NULL,
	"crop_id" uuid NOT NULL,
	"min_volume_kg" numeric(14, 3) NOT NULL,
	"max_volume_kg" numeric(14, 3) NOT NULL,
	"price_type" "price_type" NOT NULL,
	"price_xof_per_kg" bigint NOT NULL,
	"floor_xof_per_kg" bigint,
	"formula_text" text,
	"quality_spec" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payment_terms_days" integer NOT NULL,
	"pays_into_escrow" boolean DEFAULT true NOT NULL,
	"escrow_account_id" uuid,
	"status" "offtake_status" DEFAULT 'draft' NOT NULL,
	"file_id" uuid,
	"signed_at" timestamp with time zone,
	"terminated_at" timestamp with time zone,
	CONSTRAINT "offtake_contracts_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
ALTER TABLE "crop_templates" ADD CONSTRAINT "crop_templates_crop_id_crops_id_fk" FOREIGN KEY ("crop_id") REFERENCES "public"."crops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crop_varieties" ADD CONSTRAINT "crop_varieties_crop_id_crops_id_fk" FOREIGN KEY ("crop_id") REFERENCES "public"."crops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_prices" ADD CONSTRAINT "market_prices_crop_id_crops_id_fk" FOREIGN KEY ("crop_id") REFERENCES "public"."crops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plantings" ADD CONSTRAINT "plantings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crop_templates_crop_id_zone_irrigated_index" ON "crop_templates" USING btree ("crop_id","zone","irrigated");--> statement-breakpoint
CREATE UNIQUE INDEX "crop_templates_platform_uq" ON "crop_templates" USING btree ("crop_id","zone","irrigated") WHERE owner_org_id is null and variety_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "crop_templates_override_uq" ON "crop_templates" USING btree ("owner_org_id","crop_id","zone","irrigated") WHERE owner_org_id is not null and variety_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "crop_varieties_crop_id_name_index" ON "crop_varieties" USING btree ("crop_id","name");--> statement-breakpoint
CREATE INDEX "market_prices_crop_id_date_index" ON "market_prices" USING btree ("crop_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "service_platform_code_uq" ON "service_catalog" USING btree ("code") WHERE owner_org_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "service_org_code_uq" ON "service_catalog" USING btree ("owner_org_id","code") WHERE owner_org_id is not null;--> statement-breakpoint
CREATE INDEX "budget_lines_season_id_index" ON "budget_lines" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "capex_items_block_id_index" ON "capex_items" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "fee_policies_block_id_index" ON "fee_policies" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "operator_opex_block_id_index" ON "operator_opex" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "plantings_season_id_index" ON "plantings" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "plantings_plot_id_index" ON "plantings" USING btree ("plot_id");--> statement-breakpoint
CREATE INDEX "seasons_block_id_index" ON "seasons" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "seasons_owner_org_id_status_index" ON "seasons" USING btree ("owner_org_id","status");--> statement-breakpoint
CREATE INDEX "supplier_quotes_owner_org_id_service_id_index" ON "supplier_quotes" USING btree ("owner_org_id","service_id");--> statement-breakpoint
CREATE INDEX "offtake_contracts_block_id_index" ON "offtake_contracts" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "offtake_contracts_buyer_org_id_index" ON "offtake_contracts" USING btree ("buyer_org_id");