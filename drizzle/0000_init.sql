CREATE TYPE "public"."message_source" AS ENUM('webhook', 'backfill');--> statement-breakpoint
CREATE TYPE "public"."page_status" AS ENUM('active', 'token_invalid');--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"psid" text NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_page_psid_unique" UNIQUE("page_id","psid"),
	CONSTRAINT "conversations_id_page_tenant_unique" UNIQUE("id","page_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"mid" text NOT NULL,
	"text" text,
	"attachments" jsonb,
	"sent_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "message_source" NOT NULL,
	CONSTRAINT "messages_mid_unique" UNIQUE("mid")
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fb_page_id" text NOT NULL,
	"name" text NOT NULL,
	"token_enc" text NOT NULL,
	"status" "page_status" DEFAULT 'active' NOT NULL,
	"subscribed_at" timestamp with time zone,
	"backfill_state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_fb_page_id_unique" UNIQUE("fb_page_id"),
	CONSTRAINT "pages_id_tenant_unique" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_page_tenant_fk" FOREIGN KEY ("page_id","tenant_id") REFERENCES "public"."pages"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_page_tenant_fk" FOREIGN KEY ("page_id","tenant_id") REFERENCES "public"."pages"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_page_tenant_fk" FOREIGN KEY ("conversation_id","page_id","tenant_id") REFERENCES "public"."conversations"("id","page_id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_tenant_idx" ON "conversations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_sent_at_idx" ON "messages" USING btree ("conversation_id","sent_at");--> statement-breakpoint
CREATE INDEX "messages_tenant_sent_at_idx" ON "messages" USING btree ("tenant_id","sent_at");--> statement-breakpoint
CREATE INDEX "pages_tenant_idx" ON "pages" USING btree ("tenant_id");