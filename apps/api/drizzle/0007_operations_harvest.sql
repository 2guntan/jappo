CREATE TYPE "public"."farmer_ack_method" AS ENUM('otp', 'signature_photo', 'none');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_source" AS ENUM('rule', 'manual');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."crop_stage" AS ENUM('land_prep', 'sowing', 'emergence', 'vegetative', 'flowering', 'fruiting', 'maturity', 'harvested', 'failed');--> statement-breakpoint
CREATE TYPE "public"."buyer_invoice_status" AS ENUM('issued', 'partially_paid', 'paid', 'overdue', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."dispatch_status" AS ENUM('in_transit', 'accepted', 'partially_accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."escrow_receipt_status" AS ENUM('recorded', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."harvest_delivery_status" AS ENUM('recorded', 'dispatched', 'rejected', 'void');--> statement-breakpoint
ALTER TYPE "public"."otp_purpose" ADD VALUE 'delivery_ack';--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"code" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "alert_rules_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"block_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"season_id" uuid,
	"type" text NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"source" "alert_source" NOT NULL,
	"rule_code" text,
	"dedupe_key" text,
	"message" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "alert_status" DEFAULT 'open' NOT NULL,
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text
);
--> statement-breakpoint
CREATE TABLE "field_visits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"owner_org_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"plot_id" uuid NOT NULL,
	"planting_id" uuid,
	"agent_user_id" uuid,
	"visited_at" timestamp with time zone NOT NULL,
	"geo" geometry(Point, 4326),
	"crop_stage" "crop_stage" NOT NULL,
	"health_score" integer NOT NULL,
	"estimated_yield_t_ha" numeric(10, 3),
	"issues" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"photo_file_ids" uuid[] DEFAULT '{}' NOT NULL,
	"offline_client_id" text
);
--> statement-breakpoint
CREATE TABLE "service_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"owner_org_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"budget_line_id" uuid NOT NULL,
	"plot_id" uuid,
	"farmer_id" uuid,
	"qty" numeric(14, 3) NOT NULL,
	"unit" text NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	"supplier_name" text,
	"delivered_by_user_id" uuid,
	"photo_file_id" uuid,
	"farmer_ack_method" "farmer_ack_method" DEFAULT 'none' NOT NULL,
	"farmer_ack_at" timestamp with time zone,
	"geo" geometry(Point, 4326),
	"offline_client_id" text
);
--> statement-breakpoint
CREATE TABLE "buyer_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"ref" text NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"offtake_contract_id" uuid NOT NULL,
	"buyer_org_id" uuid NOT NULL,
	"dispatch_ids" uuid[] NOT NULL,
	"accepted_kg" numeric(14, 3) NOT NULL,
	"amount_xof" bigint NOT NULL,
	"lines" jsonb NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_date" date NOT NULL,
	"paid_xof" bigint DEFAULT 0 NOT NULL,
	"status" "buyer_invoice_status" DEFAULT 'issued' NOT NULL,
	"dispute_reason" text,
	"pdf_file_id" uuid,
	CONSTRAINT "buyer_invoices_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "dispatches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"ref" text NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"offtake_contract_id" uuid NOT NULL,
	"buyer_org_id" uuid NOT NULL,
	"dispatched_at" timestamp with time zone NOT NULL,
	"vehicle" text,
	"delivery_ids" uuid[] NOT NULL,
	"net_kg_total" numeric(14, 3) NOT NULL,
	"buyer_accepted_kg" numeric(14, 3),
	"buyer_rejected_kg" numeric(14, 3),
	"buyer_accepted_at" timestamp with time zone,
	"buyer_comment" text,
	"status" "dispatch_status" DEFAULT 'in_transit' NOT NULL,
	"invoice_id" uuid,
	CONSTRAINT "dispatches_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "escrow_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"escrow_account_id" uuid NOT NULL,
	"lender_org_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"season_id" uuid,
	"amount_xof" bigint NOT NULL,
	"value_date" date NOT NULL,
	"payer_org_id" uuid NOT NULL,
	"bank_reference" text NOT NULL,
	"buyer_invoice_id" uuid,
	"recorded_by" uuid,
	"recorded_by_org_id" uuid NOT NULL,
	"confirmed_by_lender_at" timestamp with time zone,
	"confirmed_by" uuid,
	"proof_file_id" uuid,
	"status" "escrow_receipt_status" DEFAULT 'recorded' NOT NULL,
	"reject_reason" text
);
--> statement-breakpoint
CREATE TABLE "harvest_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"owner_org_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"ticket_no" text NOT NULL,
	"season_id" uuid NOT NULL,
	"plot_id" uuid NOT NULL,
	"farmer_id" uuid NOT NULL,
	"planting_id" uuid NOT NULL,
	"crop_id" uuid NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	"gross_kg" numeric(14, 3) NOT NULL,
	"tare_kg" numeric(14, 3) DEFAULT '0' NOT NULL,
	"net_kg" numeric(14, 3) GENERATED ALWAYS AS (gross_kg - tare_kg) STORED,
	"moisture_pct" numeric(6, 2),
	"grade" text NOT NULL,
	"weighed_by_user_id" uuid,
	"photo_file_id" uuid,
	"farmer_ack_method" "farmer_ack_method" DEFAULT 'none' NOT NULL,
	"farmer_ack_at" timestamp with time zone,
	"offline_client_id" text,
	"status" "harvest_delivery_status" DEFAULT 'recorded' NOT NULL,
	"dispatch_id" uuid,
	"void_reason" text
);
--> statement-breakpoint
CREATE INDEX "alerts_block_id_status_index" ON "alerts" USING btree ("block_id","status");--> statement-breakpoint
CREATE INDEX "alerts_dedupe_key_status_index" ON "alerts" USING btree ("dedupe_key","status");--> statement-breakpoint
CREATE INDEX "field_visits_plot_id_visited_at_index" ON "field_visits" USING btree ("plot_id","visited_at");--> statement-breakpoint
CREATE INDEX "field_visits_block_id_index" ON "field_visits" USING btree ("block_id");--> statement-breakpoint
CREATE UNIQUE INDEX "field_visits_owner_org_id_offline_client_id_index" ON "field_visits" USING btree ("owner_org_id","offline_client_id");--> statement-breakpoint
CREATE INDEX "service_deliveries_season_id_index" ON "service_deliveries" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "service_deliveries_budget_line_id_index" ON "service_deliveries" USING btree ("budget_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_deliveries_owner_org_id_offline_client_id_index" ON "service_deliveries" USING btree ("owner_org_id","offline_client_id");--> statement-breakpoint
CREATE INDEX "buyer_invoices_buyer_org_id_index" ON "buyer_invoices" USING btree ("buyer_org_id");--> statement-breakpoint
CREATE INDEX "buyer_invoices_season_id_index" ON "buyer_invoices" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "dispatches_season_id_index" ON "dispatches" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "dispatches_buyer_org_id_index" ON "dispatches" USING btree ("buyer_org_id");--> statement-breakpoint
CREATE INDEX "escrow_receipts_block_id_index" ON "escrow_receipts" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "escrow_receipts_escrow_account_id_index" ON "escrow_receipts" USING btree ("escrow_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "escrow_receipts_escrow_account_id_bank_reference_index" ON "escrow_receipts" USING btree ("escrow_account_id","bank_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "harvest_deliveries_block_id_ticket_no_index" ON "harvest_deliveries" USING btree ("block_id","ticket_no");--> statement-breakpoint
CREATE INDEX "harvest_deliveries_season_id_farmer_id_index" ON "harvest_deliveries" USING btree ("season_id","farmer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "harvest_deliveries_owner_org_id_offline_client_id_index" ON "harvest_deliveries" USING btree ("owner_org_id","offline_client_id");