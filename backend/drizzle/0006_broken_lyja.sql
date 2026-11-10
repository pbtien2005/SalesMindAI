ALTER TYPE "public"."page_status" ADD VALUE 'disconnected';--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "connected_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;