CREATE TYPE "public"."order_status" AS ENUM('draft', 'awaiting_deposit', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('proposed', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."reply_draft_kind" AS ENUM('confirm_order', 'top_up', 'deposit_received');--> statement-breakpoint
CREATE TYPE "public"."reply_draft_status" AS ENUM('pending', 'sent', 'dismissed');--> statement-breakpoint
ALTER TYPE "public"."proposal_field" ADD VALUE 'sku';--> statement-breakpoint
ALTER TYPE "public"."proposal_field" ADD VALUE 'unit_price';--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"code" text,
	"status" "order_status" DEFAULT 'draft' NOT NULL,
	"customer_name" text,
	"phone" text,
	"address" text,
	"sku" text NOT NULL,
	"product_name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_vnd" bigint NOT NULL,
	"total_vnd" bigint NOT NULL,
	"deposit_required_vnd" bigint NOT NULL,
	"deposit_paid_vnd" bigint DEFAULT 0 NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"sale_edited_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_id_tenant_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "orders_tenant_code_unique" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"order_id" uuid,
	"message_id" uuid NOT NULL,
	"status" "payment_status" DEFAULT 'proposed' NOT NULL,
	"read_ok" boolean NOT NULL,
	"amount_vnd" bigint,
	"transfer_note" text,
	"bill_time" text,
	"bbox" jsonb,
	"read_model" text NOT NULL,
	"amount_edited" boolean DEFAULT false NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_message_id_unique" UNIQUE("message_id"),
	CONSTRAINT "payments_id_tenant_unique" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"price_vnd" bigint NOT NULL,
	CONSTRAINT "products_tenant_sku_unique" UNIQUE("tenant_id","sku")
);
--> statement-breakpoint
CREATE TABLE "reply_drafts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" "reply_draft_kind" NOT NULL,
	"text" text NOT NULL,
	"status" "reply_draft_status" DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reply_drafts_id_tenant_unique" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "deposit_percent" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "payment_instructions" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "next_order_no" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_id_tenant_unique" UNIQUE("id","tenant_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_conversation_tenant_fk" FOREIGN KEY ("conversation_id","tenant_id") REFERENCES "public"."conversations"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_conversation_tenant_fk" FOREIGN KEY ("conversation_id","tenant_id") REFERENCES "public"."conversations"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_tenant_fk" FOREIGN KEY ("order_id","tenant_id") REFERENCES "public"."orders"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_message_tenant_fk" FOREIGN KEY ("message_id","tenant_id") REFERENCES "public"."messages"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_drafts" ADD CONSTRAINT "reply_drafts_conversation_tenant_fk" FOREIGN KEY ("conversation_id","tenant_id") REFERENCES "public"."conversations"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_drafts" ADD CONSTRAINT "reply_drafts_order_tenant_fk" FOREIGN KEY ("order_id","tenant_id") REFERENCES "public"."orders"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_one_open_per_conversation" ON "orders" USING btree ("conversation_id") WHERE "orders"."status" in ('draft', 'awaiting_deposit');--> statement-breakpoint
CREATE INDEX "orders_tenant_created_idx" ON "orders" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_tenant_confirmed_idx" ON "payments" USING btree ("tenant_id","confirmed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reply_drafts_one_pending" ON "reply_drafts" USING btree ("order_id","kind") WHERE "reply_drafts"."status" = 'pending';
