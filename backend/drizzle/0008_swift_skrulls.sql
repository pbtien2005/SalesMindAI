ALTER TYPE "public"."message_source" ADD VALUE 'send';--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sent_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;