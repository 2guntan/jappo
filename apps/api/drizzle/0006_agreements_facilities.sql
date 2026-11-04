CREATE TYPE "public"."contract_status" AS ENUM('draft', 'out_for_signature', 'partially_signed', 'signed', 'voided');--> statement-breakpoint
CREATE TYPE "public"."contract_party_type" AS ENUM('org', 'farmer');--> statement-breakpoint
CREATE TYPE "public"."signature_method" AS ENUM('otp_sms', 'otp_email', 'in_person_witnessed');--> statement-breakpoint
CREATE TYPE "public"."disbursement_beneficiary_type" AS ENUM('supplier', 'operator', 'farmer');--> statement-breakpoint
CREATE TYPE "public"."disbursement_status" AS ENUM('requested', 'approved', 'executed', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."facility_status" AS ENUM('pending_cp', 'active', 'in_arrears', 'repaid', 'defaulted', 'restructured');--> statement-breakpoint
CREATE TYPE "public"."repayment_source" AS ENUM('settlement', 'direct', 'guarantee_call', 'insurance');--> statement-breakpoint
CREATE TYPE "public"."schedule_line_status" AS ENUM('due', 'paid', 'partial', 'overdue');--> statement-breakpoint
CREATE TABLE "contract_parties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"contract_id" uuid NOT NULL,
	"party_type" "contract_party_type" NOT NULL,
	"org_id" uuid,
	"farmer_id" uuid,
	"role_label" text NOT NULL,
	"signer_user_id" uuid,
	"signer_phone" text,
	"sign_order" integer DEFAULT 1 NOT NULL,
	"signed_at" timestamp with time zone,
	"signature_id" uuid
);
--> statement-breakpoint
CREATE TABLE "contract_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"code" text NOT NULL,
	"locale" text NOT NULL,
	"template_version" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"body_hbs" text NOT NULL,
	"variables_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"ref" text NOT NULL,
	"template_id" uuid NOT NULL,
	"type" text NOT NULL,
	"block_id" uuid NOT NULL,
	"season_id" uuid,
	"owner_org_id" uuid NOT NULL,
	"related_type" text NOT NULL,
	"related_id" uuid NOT NULL,
	"locale" text DEFAULT 'fr' NOT NULL,
	"data" jsonb NOT NULL,
	"body_rendered" text,
	"status" "contract_status" DEFAULT 'draft' NOT NULL,
	"pdf_file_id" uuid,
	"signed_pdf_file_id" uuid,
	"content_sha256" text,
	"sent_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	CONSTRAINT "contracts_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"contract_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"method" "signature_method" NOT NULL,
	"signer_name" text NOT NULL,
	"signer_identifier" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"geo" geometry(Point, 4326),
	"content_sha256" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"witness_user_id" uuid,
	"evidence_file_id" uuid
);
--> statement-breakpoint
CREATE TABLE "disbursements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"facility_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"amount_xof" bigint NOT NULL,
	"purpose" text NOT NULL,
	"beneficiary_type" "disbursement_beneficiary_type" NOT NULL,
	"beneficiary_org_id" uuid,
	"beneficiary_farmer_id" uuid,
	"beneficiary_name" text NOT NULL,
	"budget_line_ids" uuid[] DEFAULT '{}' NOT NULL,
	"capex_item_ids" uuid[] DEFAULT '{}' NOT NULL,
	"status" "disbursement_status" DEFAULT 'requested' NOT NULL,
	"requested_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"executed_by" uuid,
	"executed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"bank_reference" text,
	"proof_file_id" uuid,
	"reject_reason" text,
	CONSTRAINT "disbursements_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "escrow_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"lender_org_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"bank_name" text NOT NULL,
	"account_label" text NOT NULL,
	"account_number_masked" text NOT NULL,
	"iban_enc" text,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"ref" text NOT NULL,
	"award_id" uuid NOT NULL,
	"tranche_id" uuid NOT NULL,
	"tranche_type" text NOT NULL,
	"lender_org_id" uuid NOT NULL,
	"operator_org_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"borrower_type" "borrower_type" NOT NULL,
	"borrower_org_id" uuid,
	"principal_xof" bigint NOT NULL,
	"rate_bps" integer NOT NULL,
	"rate_method" "rate_method" NOT NULL,
	"upfront_fee_bps" integer NOT NULL,
	"tenor_months" integer NOT NULL,
	"grace_months" integer NOT NULL,
	"grace_type" "grace_type" NOT NULL,
	"repayment_profile" "repayment_profile" NOT NULL,
	"start_date" date NOT NULL,
	"maturity_date" date NOT NULL,
	"escrow_account_id" uuid,
	"status" "facility_status" DEFAULT 'pending_cp' NOT NULL,
	"lender_loan_ref" text,
	"activated_at" timestamp with time zone,
	CONSTRAINT "facilities_ref_unique" UNIQUE("ref"),
	CONSTRAINT "facilities_awardId_unique" UNIQUE("award_id")
);
--> statement-breakpoint
CREATE TABLE "facility_farmer_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"facility_id" uuid NOT NULL,
	"farmer_id" uuid NOT NULL,
	"principal_xof" bigint NOT NULL,
	"interest_xof" bigint NOT NULL,
	"fees_xof" bigint DEFAULT 0 NOT NULL,
	"due_xof" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repayments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"facility_id" uuid NOT NULL,
	"settlement_run_id" uuid,
	"amount_xof" bigint NOT NULL,
	"principal_xof" bigint NOT NULL,
	"interest_xof" bigint NOT NULL,
	"fees_xof" bigint DEFAULT 0 NOT NULL,
	"value_date" date NOT NULL,
	"source" "repayment_source" NOT NULL,
	"reference" text
);
--> statement-breakpoint
CREATE TABLE "schedule_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"facility_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"due_date" date NOT NULL,
	"principal_xof" bigint NOT NULL,
	"interest_xof" bigint NOT NULL,
	"fees_xof" bigint DEFAULT 0 NOT NULL,
	"total_xof" bigint NOT NULL,
	"paid_xof" bigint DEFAULT 0 NOT NULL,
	"status" "schedule_line_status" DEFAULT 'due' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_parties" ADD CONSTRAINT "contract_parties_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_party_id_contract_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."contract_parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_farmer_allocations" ADD CONSTRAINT "facility_farmer_allocations_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayments" ADD CONSTRAINT "repayments_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_lines" ADD CONSTRAINT "schedule_lines_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_parties_contract_id_index" ON "contract_parties" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contract_parties_org_id_index" ON "contract_parties" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "contract_parties_farmer_id_index" ON "contract_parties" USING btree ("farmer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_templates_code_locale_template_version_index" ON "contract_templates" USING btree ("code","locale","template_version");--> statement-breakpoint
CREATE INDEX "contracts_block_id_type_index" ON "contracts" USING btree ("block_id","type");--> statement-breakpoint
CREATE INDEX "contracts_related_type_related_id_index" ON "contracts" USING btree ("related_type","related_id");--> statement-breakpoint
CREATE INDEX "signatures_contract_id_index" ON "signatures" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "disbursements_facility_id_index" ON "disbursements" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "escrow_accounts_block_id_index" ON "escrow_accounts" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "escrow_accounts_lender_org_id_index" ON "escrow_accounts" USING btree ("lender_org_id");--> statement-breakpoint
CREATE INDEX "facilities_block_id_index" ON "facilities" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "facilities_lender_org_id_status_index" ON "facilities" USING btree ("lender_org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "facility_farmer_allocations_facility_id_farmer_id_index" ON "facility_farmer_allocations" USING btree ("facility_id","farmer_id");--> statement-breakpoint
CREATE INDEX "repayments_facility_id_index" ON "repayments" USING btree ("facility_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_lines_facility_id_seq_index" ON "schedule_lines" USING btree ("facility_id","seq");