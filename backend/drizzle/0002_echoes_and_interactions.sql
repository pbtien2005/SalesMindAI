CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."sender_kind" AS ENUM('customer', 'page_app', 'page_inbox', 'page_other', 'page_unknown');--> statement-breakpoint
CREATE TABLE "page_policy_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_policy_events_dedupe" UNIQUE("page_id","occurred_at","action")
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "last_user_interaction_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "last_page_message_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "direction" "message_direction" DEFAULT 'inbound' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sender_kind" "sender_kind" DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "app_id" text;--> statement-breakpoint
ALTER TABLE "page_policy_events" ADD CONSTRAINT "page_policy_events_page_tenant_fk" FOREIGN KEY ("page_id","tenant_id") REFERENCES "public"."pages"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_policy_events_tenant_idx" ON "page_policy_events" USING btree ("tenant_id","occurred_at");
--> statement-breakpoint
-- Dữ liệu cũ: trước migration này chỉ lưu tin của khách, nên lần tương tác cuối của khách chính là tin cuối.
UPDATE "conversations" SET "last_user_interaction_at" = "last_message_at" WHERE "last_user_interaction_at" IS NULL;
