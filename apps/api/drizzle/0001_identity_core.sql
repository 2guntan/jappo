CREATE TYPE "public"."file_visibility" AS ENUM('private', 'shared_via_grant');--> statement-breakpoint
CREATE TYPE "public"."grant_scope" AS ENUM('read', 'comment', 'act');--> statement-breakpoint
CREATE TYPE "public"."doc_review_status" AS ENUM('submitted', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."kyc_doc_type" AS ENUM('ninea', 'rccm', 'statuts', 'id_representative', 'approval_bceao', 'other');--> statement-breakpoint
CREATE TYPE "public"."kyc_status" AS ENUM('pending', 'submitted', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."legal_form" AS ENUM('SA', 'SARL', 'SAS', 'GIE', 'cooperative', 'association', 'mutuelle', 'etablissement_credit', 'sfd', 'other');--> statement-breakpoint
CREATE TYPE "public"."lender_kind" AS ENUM('bank', 'sfd', 'dfi', 'fund', 'leasing');--> statement-breakpoint
CREATE TYPE "public"."org_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."org_type" AS ENUM('platform', 'operator', 'lender', 'buyer', 'guarantor', 'insurer', 'supplier', 'farmer_group');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('login', 'farmer_login', 'signature', 'wallet_verify');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'failed', 'read');--> statement-breakpoint
CREATE TABLE "access_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"grantee_org_id" uuid NOT NULL,
	"scope" "grant_scope" NOT NULL,
	"granted_by_event" text NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"org_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"request_id" text,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "audit_log_seq_unique" UNIQUE("seq")
);
--> statement-breakpoint
CREATE TABLE "events_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"org_id" uuid,
	"actor" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"org_id" uuid,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"owner_org_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"visibility" "file_visibility" DEFAULT 'private' NOT NULL,
	"linked_type" text,
	"linked_id" uuid,
	"uploaded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"movable" boolean DEFAULT false NOT NULL,
	CONSTRAINT "holidays_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"principal_id" text NOT NULL,
	"route" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_sequences" (
	"prefix" text NOT NULL,
	"year" integer NOT NULL,
	"last" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ref_sequences_prefix_year_pk" PRIMARY KEY("prefix","year")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"code" text PRIMARY KEY NOT NULL,
	"org_types" text[] NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"roles" text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_prefix_unique" UNIQUE("prefix")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"org_id" uuid NOT NULL,
	"email" text,
	"phone" text,
	"roles" text[] NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invitations_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"roles" text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_kyc_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"org_id" uuid NOT NULL,
	"doc_type" "kyc_doc_type" NOT NULL,
	"file_id" uuid NOT NULL,
	"status" "doc_review_status" DEFAULT 'submitted' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"comment" text
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"type" "org_type" NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"legal_form" "legal_form" NOT NULL,
	"ninea" text,
	"rccm" text,
	"country" text DEFAULT 'SN' NOT NULL,
	"region" text,
	"address" text,
	"phone" text,
	"email" text,
	"logo_file_id" uuid,
	"locale" text DEFAULT 'fr' NOT NULL,
	"kyc_status" "kyc_status" DEFAULT 'pending' NOT NULL,
	"status" "org_status" DEFAULT 'active' NOT NULL,
	"lender_kind" "lender_kind",
	"bceao_approval_no" text,
	"plan_id" uuid,
	"annual_volume_kg_estimate" numeric(14, 3),
	"years_in_business" integer,
	"bank_reference_file_id" uuid
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"phone" text NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"subject_id" uuid,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"mfa" boolean DEFAULT false NOT NULL,
	"user_agent" text,
	"ip" text,
	CONSTRAINT "refresh_tokens_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "user_tokens_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"email" text,
	"phone" text,
	"full_name" text NOT NULL,
	"password_hash" text,
	"locale" text DEFAULT 'fr' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"email_verified_at" timestamp with time zone,
	"mfa_totp_secret" text,
	"mfa_enabled_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"channels" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"recipient_type" text NOT NULL,
	"recipient_id" uuid NOT NULL,
	"org_id" uuid,
	"channel" "notification_channel" NOT NULL,
	"destination" text,
	"template_code" text NOT NULL,
	"locale" text DEFAULT 'fr' NOT NULL,
	"data" jsonb NOT NULL,
	"subject" text,
	"body" text,
	"link" text,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"provider" text,
	"provider_ref" text,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_kyc_documents" ADD CONSTRAINT "org_kyc_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_grants_grantee_org_id_resource_type_index" ON "access_grants" USING btree ("grantee_org_id","resource_type");--> statement-breakpoint
CREATE UNIQUE INDEX "access_grants_resource_type_resource_id_grantee_org_id_scope_index" ON "access_grants" USING btree ("resource_type","resource_id","grantee_org_id","scope");--> statement-breakpoint
CREATE INDEX "audit_log_resource_type_resource_id_index" ON "audit_log" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_id_at_index" ON "audit_log" USING btree ("org_id","at");--> statement-breakpoint
CREATE INDEX "events_outbox_pending_idx" ON "events_outbox" USING btree ("occurred_at") WHERE dispatched_at is null;--> statement-breakpoint
CREATE INDEX "events_outbox_org_id_occurred_at_index" ON "events_outbox" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_org_id_key_index" ON "feature_flags" USING btree ("org_id","key");--> statement-breakpoint
CREATE INDEX "files_owner_org_id_index" ON "files" USING btree ("owner_org_id");--> statement-breakpoint
CREATE INDEX "files_linked_type_linked_id_index" ON "files" USING btree ("linked_type","linked_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_key_principal_id_route_index" ON "idempotency_keys" USING btree ("key","principal_id","route");--> statement-breakpoint
CREATE INDEX "api_keys_org_id_index" ON "api_keys" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "invitations_org_id_index" ON "invitations" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_id_org_id_index" ON "memberships" USING btree ("user_id","org_id");--> statement-breakpoint
CREATE INDEX "memberships_org_id_index" ON "memberships" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "org_kyc_documents_org_id_index" ON "org_kyc_documents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "organizations_type_kyc_status_index" ON "organizations" USING btree ("type","kyc_status");--> statement-breakpoint
CREATE INDEX "otp_codes_phone_purpose_created_at_index" ON "otp_codes" USING btree ("phone","purpose","created_at");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_id_index" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_index" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_tokens_user_id_purpose_index" ON "user_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "notifications_recipient_type_recipient_id_channel_index" ON "notifications" USING btree ("recipient_type","recipient_id","channel");--> statement-breakpoint
CREATE INDEX "notifications_status_channel_index" ON "notifications" USING btree ("status","channel");