CREATE TYPE "public"."kpi_scope_type" AS ENUM('block', 'season', 'lender_portfolio', 'platform');--> statement-breakpoint
CREATE TYPE "public"."report_type" AS ENUM('lender_monthly', 'season_close', 'guarantor_portfolio');--> statement-breakpoint
CREATE TABLE "kpi_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"scope_type" "kpi_scope_type" NOT NULL,
	"scope_id" uuid NOT NULL,
	"date" date NOT NULL,
	"metrics" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"owner_org_id" uuid NOT NULL,
	"type" "report_type" NOT NULL,
	"scope_id" uuid,
	"period" text NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"pdf_file_id" uuid,
	"generated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_snapshots_scope_date_uq" ON "kpi_snapshots" USING btree ("scope_type","scope_id","date");--> statement-breakpoint
CREATE INDEX "kpi_snapshots_scope_type_scope_id_index" ON "kpi_snapshots" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "reports_owner_org_id_index" ON "reports" USING btree ("owner_org_id");