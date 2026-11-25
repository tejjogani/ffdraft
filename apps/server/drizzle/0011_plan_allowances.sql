CREATE TABLE "plan_claim" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"allowance" text NOT NULL,
	"period" text NOT NULL,
	"slot" integer,
	"state" text NOT NULL,
	"subject" text NOT NULL,
	"piece_id" text,
	"user_id" text NOT NULL,
	"actor" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "plan" text;--> statement-breakpoint
ALTER TABLE "plan_claim" ADD CONSTRAINT "plan_claim_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_claim_idempotency_idx" ON "plan_claim" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_claim_slot_idx" ON "plan_claim" USING btree ("org_id","allowance","period","slot");