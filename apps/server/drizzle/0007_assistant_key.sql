CREATE TABLE "assistant_key" (
	"org_id" text PRIMARY KEY NOT NULL,
	"sealed" text NOT NULL,
	"last4" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_key" ADD CONSTRAINT "assistant_key_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;