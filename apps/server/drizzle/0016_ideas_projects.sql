ALTER TABLE "agent_run" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "collection" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "usage_event" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_parent_id_collection_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."collection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_event_piece_idx" ON "usage_event" USING btree ("org_id","piece_id");