CREATE TABLE "deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"fb_user_id" text NOT NULL,
	"status" text NOT NULL,
	"deleted_conversations" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deletion_requests_code_unique" UNIQUE("code")
);
