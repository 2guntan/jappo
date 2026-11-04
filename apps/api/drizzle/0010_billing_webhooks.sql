CREATE TYPE "public"."platform_invoice_status" AS ENUM('draft', 'issued', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."plan_price_model" AS ENUM('per_ha_season', 'annual_seat', 'free');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"org_types" text[] NOT NULL,
	"price_model" "plan_price_model" NOT NULL,
	"unit_price_xof" bigint DEFAULT 0 NOT NULL,
	"structuring_fee_bps" integer DEFAULT 0 NOT NULL,
	"included_seats" integer DEFAULT 0 NOT NULL,
	"features" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "platform_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"ref" text NOT NULL,
	"org_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"lines" jsonb NOT NULL,
	"amount_xof" bigint NOT NULL,
	"tax_xof" bigint NOT NULL,
	"total_xof" bigint NOT NULL,
	"status" "platform_invoice_status" DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone,
	"due_date" date NOT NULL,
	"pdf_file_id" uuid,
	"paid_at" timestamp with time zone,
	"payment_reference" text,
	"void_reason" text,
	"source_key" text NOT NULL,
	CONSTRAINT "platform_invoices_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"org_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" "subscription_status" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"endpoint_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_status_code" integer,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"org_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret_enc" text NOT NULL,
	"event_types" text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "billing_status" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_invoices_source_key_index" ON "platform_invoices" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "platform_invoices_org_id_status_index" ON "platform_invoices" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "subscriptions_org_id_status_index" ON "subscriptions" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_endpoint_id_event_id_index" ON "webhook_deliveries" USING btree ("endpoint_id","event_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_next_attempt_at_index" ON "webhook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_org_id_index" ON "webhook_endpoints" USING btree ("org_id");