CREATE TABLE "oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"state_hash" text NOT NULL,
	"nonce_hash" text,
	"tenant_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_states_state_hash_unique" UNIQUE("state_hash")
);
--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_states_tenant_idx" ON "oauth_states" USING btree ("tenant_id");