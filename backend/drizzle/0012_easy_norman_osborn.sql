CREATE TYPE "public"."customer_status" AS ENUM('new', 'consulting', 'quoted', 'won', 'lost');--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "customer_status" "customer_status" DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "customer_status_by" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "customer_status_at" timestamp with time zone;