CREATE TYPE "public"."award_status" AS ENUM('proposed', 'accepted_by_lender', 'declined_by_lender', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."bid_status" AS ENUM('draft', 'submitted', 'withdrawn', 'opened', 'awarded', 'not_awarded', 'expired');--> statement-breakpoint
CREATE TYPE "public"."borrower_type" AS ENUM('operator', 'farmers', 'farmer_group');--> statement-breakpoint
CREATE TYPE "public"."financing_request_status" AS ENUM('draft', 'submitted', 'in_tender', 'awarded', 'contracted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."grace_type" AS ENUM('interest_only', 'capitalised');--> statement-breakpoint
CREATE TYPE "public"."rfp_invitation_status" AS ENUM('invited', 'viewed', 'declined', 'bid_submitted');--> statement-breakpoint
CREATE TYPE "public"."rate_method" AS ENUM('flat', 'declining');--> statement-breakpoint
CREATE TYPE "public"."repayment_profile" AS ENUM('bullet', 'seasonal', 'annuity', 'equal_principal');--> statement-breakpoint
CREATE TYPE "public"."rfp_status" AS ENUM('draft', 'open', 'closed', 'evaluation', 'awarded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."tranche_status" AS ENUM('open', 'fully_awarded', 'partially_awarded', 'unawarded');--> statement-breakpoint
CREATE TYPE "public"."tranche_type" AS ENUM('seasonal', 'investment');--> statement-breakpoint
CREATE TABLE "awards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"rfp_id" uuid NOT NULL,
	"bid_id" uuid NOT NULL,
	"tranche_id" uuid NOT NULL,
	"lender_org_id" uuid NOT NULL,
	"amount_xof" bigint NOT NULL,
	"status" "award_status" DEFAULT 'proposed' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"lender_response_at" timestamp with time zone,
	"decline_reason" text
);
--> statement-breakpoint
CREATE TABLE "bid_evaluations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"bid_id" uuid NOT NULL,
	"effective_annual_rate_bps" integer NOT NULL,
	"score_cost" numeric(7, 2) NOT NULL,
	"score_share" numeric(7, 2) NOT NULL,
	"score_speed" numeric(7, 2) NOT NULL,
	"score_conditions" numeric(7, 2) NOT NULL,
	"total_score" numeric(7, 2) NOT NULL,
	"rank" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bid_evaluations_bidId_unique" UNIQUE("bid_id")
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"rfp_id" uuid NOT NULL,
	"tranche_id" uuid NOT NULL,
	"lender_org_id" uuid NOT NULL,
	"status" "bid_status" DEFAULT 'draft' NOT NULL,
	"amount_xof" bigint NOT NULL,
	"share_pct" numeric(7, 4) NOT NULL,
	"rate_bps" integer NOT NULL,
	"rate_method" "rate_method" NOT NULL,
	"upfront_fee_bps" integer DEFAULT 0 NOT NULL,
	"tenor_months" integer NOT NULL,
	"grace_months" integer DEFAULT 0 NOT NULL,
	"grace_type" "grace_type" DEFAULT 'interest_only' NOT NULL,
	"repayment_profile" "repayment_profile" NOT NULL,
	"security_requirements" text[] DEFAULT '{}'::text[] NOT NULL,
	"cash_collateral_pct" numeric(7, 4) DEFAULT '0' NOT NULL,
	"conditions_precedent" text[] DEFAULT '{}'::text[] NOT NULL,
	"days_to_disbursement" integer NOT NULL,
	"valid_until" date NOT NULL,
	"accepts_partial" boolean DEFAULT true NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"comments" text
);
--> statement-breakpoint
CREATE TABLE "financing_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"ref" text NOT NULL,
	"block_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"dossier_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"status" "financing_request_status" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "financing_requests_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "lender_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"lender_org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"crop_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"regions" text[] DEFAULT '{}'::text[] NOT NULL,
	"tranche_types" text[] NOT NULL,
	"min_ticket_xof" bigint NOT NULL,
	"max_ticket_xof" bigint NOT NULL,
	"min_readiness_score" integer DEFAULT 0 NOT NULL,
	"max_tenor_months" integer NOT NULL,
	"requires_guarantee" boolean DEFAULT false NOT NULL,
	"min_guarantee_pct" numeric(7, 4) DEFAULT '0' NOT NULL,
	"requires_insurance" boolean DEFAULT false NOT NULL,
	"max_rate_bps" integer,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "rfp_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"rfp_id" uuid NOT NULL,
	"lender_org_id" uuid NOT NULL,
	"lender_profile_id" uuid,
	"match_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "rfp_invitation_status" DEFAULT 'invited' NOT NULL,
	"declined_reason" text,
	"invited_at" timestamp with time zone,
	"viewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rfp_questions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"rfp_id" uuid NOT NULL,
	"asked_by_org_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"answered_at" timestamp with time zone,
	"published" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"ref" text NOT NULL,
	"financing_request_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"status" "rfp_status" DEFAULT 'draft' NOT NULL,
	"opened_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"instructions" text,
	"min_bid_share_pct" numeric(7, 4) DEFAULT '20' NOT NULL,
	"extensions" integer DEFAULT 0 NOT NULL,
	"cancel_reason" text,
	CONSTRAINT "rfps_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "tranches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"financing_request_id" uuid NOT NULL,
	"type" "tranche_type" NOT NULL,
	"amount_xof" bigint NOT NULL,
	"requested_tenor_months" integer NOT NULL,
	"requested_grace_months" integer DEFAULT 0 NOT NULL,
	"repayment_profile" "repayment_profile" NOT NULL,
	"borrower_type" "borrower_type" NOT NULL,
	"borrower_org_id" uuid,
	"purpose" text NOT NULL,
	"status" "tranche_status" DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_rfp_id_rfps_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_evaluations" ADD CONSTRAINT "bid_evaluations_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_rfp_id_rfps_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_tranche_id_tranches_id_fk" FOREIGN KEY ("tranche_id") REFERENCES "public"."tranches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_invitations" ADD CONSTRAINT "rfp_invitations_rfp_id_rfps_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_questions" ADD CONSTRAINT "rfp_questions_rfp_id_rfps_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfps" ADD CONSTRAINT "rfps_financing_request_id_financing_requests_id_fk" FOREIGN KEY ("financing_request_id") REFERENCES "public"."financing_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tranches" ADD CONSTRAINT "tranches_financing_request_id_financing_requests_id_fk" FOREIGN KEY ("financing_request_id") REFERENCES "public"."financing_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "awards_rfp_id_index" ON "awards" USING btree ("rfp_id");--> statement-breakpoint
CREATE INDEX "awards_lender_org_id_index" ON "awards" USING btree ("lender_org_id");--> statement-breakpoint
CREATE INDEX "bids_rfp_id_lender_org_id_index" ON "bids" USING btree ("rfp_id","lender_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bids_one_active_uq" ON "bids" USING btree ("rfp_id","tranche_id","lender_org_id") WHERE status <> 'withdrawn';--> statement-breakpoint
CREATE INDEX "financing_requests_owner_org_id_status_index" ON "financing_requests" USING btree ("owner_org_id","status");--> statement-breakpoint
CREATE INDEX "financing_requests_season_id_index" ON "financing_requests" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "lender_profiles_lender_org_id_index" ON "lender_profiles" USING btree ("lender_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rfp_invitations_rfp_id_lender_org_id_index" ON "rfp_invitations" USING btree ("rfp_id","lender_org_id");--> statement-breakpoint
CREATE INDEX "rfp_invitations_lender_org_id_index" ON "rfp_invitations" USING btree ("lender_org_id");--> statement-breakpoint
CREATE INDEX "rfp_questions_rfp_id_index" ON "rfp_questions" USING btree ("rfp_id");--> statement-breakpoint
CREATE INDEX "rfps_status_deadline_at_index" ON "rfps" USING btree ("status","deadline_at");--> statement-breakpoint
CREATE INDEX "rfps_financing_request_id_index" ON "rfps" USING btree ("financing_request_id");--> statement-breakpoint
CREATE INDEX "tranches_financing_request_id_index" ON "tranches" USING btree ("financing_request_id");