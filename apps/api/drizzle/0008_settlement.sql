CREATE TYPE "public"."arrears_bucket" AS ENUM('seasonal_debt', 'investment_fee', 'operator_fees');--> statement-breakpoint
CREATE TYPE "public"."arrears_status" AS ENUM('open', 'settled', 'written_off', 'claimed_guarantee');--> statement-breakpoint
CREATE TYPE "public"."payout_beneficiary_type" AS ENUM('lender', 'operator', 'farmer', 'supplier');--> statement-breakpoint
CREATE TYPE "public"."payout_channel" AS ENUM('bank_transfer', 'mobile_money');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'exported', 'sent', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('draft', 'computed', 'approved_operator', 'approved_lenders', 'instructed', 'executed', 'reconciled');--> statement-breakpoint
CREATE TABLE "farmer_arrears" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"farmer_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"origin_run_id" uuid NOT NULL,
	"bucket" "arrears_bucket" NOT NULL,
	"amount_xof" bigint NOT NULL,
	"facility_id" uuid,
	"remaining_xof" bigint NOT NULL,
	"status" "arrears_status" DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farmer_statements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"run_id" uuid NOT NULL,
	"farmer_id" uuid NOT NULL,
	"pdf_file_id" uuid,
	"sms_text" text NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payout_instructions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"run_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"beneficiary_type" "payout_beneficiary_type" NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"beneficiary_name" text NOT NULL,
	"facility_id" uuid,
	"channel" "payout_channel" NOT NULL,
	"destination_masked" text NOT NULL,
	"held_for_farmer" boolean DEFAULT false NOT NULL,
	"amount_xof" bigint NOT NULL,
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"confirmed_at" timestamp with time zone,
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE "settlement_lender_approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"run_id" uuid NOT NULL,
	"lender_org_id" uuid NOT NULL,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settlement_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"run_id" uuid NOT NULL,
	"farmer_id" uuid NOT NULL,
	"gross_credit_xof" bigint NOT NULL,
	"seasonal_debt_paid_xof" bigint NOT NULL,
	"investment_fee_paid_xof" bigint NOT NULL,
	"operator_fees_paid_xof" bigint NOT NULL,
	"other_deductions_xof" bigint NOT NULL,
	"solidarity_contribution_xof" bigint NOT NULL,
	"solidarity_received_xof" bigint NOT NULL,
	"payout_xof" bigint NOT NULL,
	"arrears_created_xof" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"ref" text NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"status" "settlement_status" DEFAULT 'draft' NOT NULL,
	"receipts_total_xof" bigint DEFAULT 0 NOT NULL,
	"inputs" jsonb NOT NULL,
	"outputs" jsonb NOT NULL,
	"engine_version" text NOT NULL,
	"computed_at" timestamp with time zone,
	"approved_operator_by" uuid,
	"approved_operator_at" timestamp with time zone,
	"instructed_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone,
	CONSTRAINT "settlement_runs_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
ALTER TABLE "farmer_statements" ADD CONSTRAINT "farmer_statements_run_id_settlement_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."settlement_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_instructions" ADD CONSTRAINT "payout_instructions_run_id_settlement_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."settlement_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lender_approvals" ADD CONSTRAINT "settlement_lender_approvals_run_id_settlement_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."settlement_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_run_id_settlement_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."settlement_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "farmer_arrears_farmer_id_status_index" ON "farmer_arrears" USING btree ("farmer_id","status");--> statement-breakpoint
CREATE INDEX "farmer_arrears_origin_run_id_index" ON "farmer_arrears" USING btree ("origin_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "farmer_statements_run_id_farmer_id_index" ON "farmer_statements" USING btree ("run_id","farmer_id");--> statement-breakpoint
CREATE INDEX "payout_instructions_run_id_index" ON "payout_instructions" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_instructions_run_id_ref_index" ON "payout_instructions" USING btree ("run_id","ref");--> statement-breakpoint
CREATE INDEX "settlement_lender_approvals_run_id_index" ON "settlement_lender_approvals" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_lines_run_id_farmer_id_index" ON "settlement_lines" USING btree ("run_id","farmer_id");--> statement-breakpoint
CREATE INDEX "settlement_runs_season_id_index" ON "settlement_runs" USING btree ("season_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_runs_one_per_season_uq" ON "settlement_runs" USING btree ("season_id");