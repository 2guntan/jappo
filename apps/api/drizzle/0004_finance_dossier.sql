CREATE TYPE "public"."dossier_status" AS ENUM('draft', 'frozen', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."risk_cover_status" AS ENUM('proposed', 'committed', 'active', 'expired');--> statement-breakpoint
CREATE TYPE "public"."risk_cover_type" AS ENUM('guarantee', 'index_insurance', 'indemnity_insurance', 'first_loss');--> statement-breakpoint
CREATE TABLE "financing_assumptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"season_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"seasonal" jsonb,
	"investment" jsonb,
	"seasons_per_year" integer DEFAULT 1 NOT NULL,
	"discount_rate_bps" integer DEFAULT 1200 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"block_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"financing_request_id" uuid,
	"engine_version" text NOT NULL,
	"inputs_hash" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"outputs" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"computed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "dossiers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"ref" text NOT NULL,
	"block_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"dossier_version" integer NOT NULL,
	"status" "dossier_status" DEFAULT 'draft' NOT NULL,
	"readiness_score" integer NOT NULL,
	"grade" text NOT NULL,
	"gates" jsonb NOT NULL,
	"score_breakdown" jsonb NOT NULL,
	"model_run_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"content_sha256" text NOT NULL,
	"pdf_file_id" uuid,
	"pdf_status" text DEFAULT 'pending' NOT NULL,
	"data_room_manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"frozen_at" timestamp with time zone,
	CONSTRAINT "dossiers_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "risk_covers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"tranche_id" uuid,
	"block_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"type" "risk_cover_type" NOT NULL,
	"provider_org_id" uuid,
	"provider_name" text NOT NULL,
	"coverage_pct" numeric(7, 4) NOT NULL,
	"cap_xof" bigint,
	"premium_xof" bigint,
	"status" "risk_cover_status" DEFAULT 'proposed' NOT NULL,
	"file_id" uuid
);
--> statement-breakpoint
CREATE UNIQUE INDEX "financing_assumptions_season_id_index" ON "financing_assumptions" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "model_runs_season_id_computed_at_index" ON "model_runs" USING btree ("season_id","computed_at");--> statement-breakpoint
CREATE INDEX "dossiers_season_id_dossier_version_index" ON "dossiers" USING btree ("season_id","dossier_version");--> statement-breakpoint
CREATE INDEX "risk_covers_block_id_index" ON "risk_covers" USING btree ("block_id");