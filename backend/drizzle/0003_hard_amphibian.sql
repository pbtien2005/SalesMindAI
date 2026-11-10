CREATE TYPE "public"."extraction_run_status" AS ENUM('succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."proposal_field" AS ENUM('customer_name', 'phone', 'address', 'product_interest', 'quantity', 'budget', 'timeline', 'intent', 'message_purpose');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'accepted', 'edited', 'dismissed', 'superseded');--> statement-breakpoint
CREATE TABLE "demo_clock" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"offset_ms" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"up_to_message_id" uuid NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"status" "extraction_run_status" NOT NULL,
	"failure_reason" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"fields_proposed" integer DEFAULT 0 NOT NULL,
	"fields_rejected" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_runs_idempotency" UNIQUE("conversation_id","up_to_message_id","prompt_version"),
	CONSTRAINT "extraction_runs_id_tenant_unique" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "followup_state" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stopped_at" timestamp with time zone NOT NULL,
	"stopped_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_fields" (
	"conversation_id" uuid NOT NULL,
	"field" "proposal_field" NOT NULL,
	"tenant_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	"proposal_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_fields_conversation_id_field_pk" PRIMARY KEY("conversation_id","field")
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"field" "proposal_field" NOT NULL,
	"value" jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"decided_value" jsonb,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposals_id_tenant_unique" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"title" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"done_at" timestamp with time zone,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_id_tenant_unique" UNIQUE("id","tenant_id");--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ai_extraction_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ai_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_up_to_message_id_messages_id_fk" FOREIGN KEY ("up_to_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_conversation_tenant_fk" FOREIGN KEY ("conversation_id","tenant_id") REFERENCES "public"."conversations"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_state" ADD CONSTRAINT "followup_state_conversation_tenant_fk" FOREIGN KEY ("conversation_id","tenant_id") REFERENCES "public"."conversations"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_fields" ADD CONSTRAINT "profile_fields_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_fields" ADD CONSTRAINT "profile_fields_conversation_tenant_fk" FOREIGN KEY ("conversation_id","tenant_id") REFERENCES "public"."conversations"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_conversation_tenant_fk" FOREIGN KEY ("conversation_id","tenant_id") REFERENCES "public"."conversations"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_run_tenant_fk" FOREIGN KEY ("run_id","tenant_id") REFERENCES "public"."extraction_runs"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_conversation_tenant_fk" FOREIGN KEY ("conversation_id","tenant_id") REFERENCES "public"."conversations"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extraction_runs_conversation_idx" ON "extraction_runs" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_one_pending_per_field" ON "proposals" USING btree ("conversation_id","field") WHERE "proposals"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "proposals_conversation_idx" ON "proposals" USING btree ("conversation_id","status");--> statement-breakpoint
CREATE INDEX "proposals_tenant_status_idx" ON "proposals" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "tasks_tenant_due_idx" ON "tasks" USING btree ("tenant_id","due_at");
