ALTER TABLE "piece" ADD COLUMN "directions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "piece" ADD COLUMN "chosen_direction_id" text;--> statement-breakpoint
ALTER TABLE "piece" ADD COLUMN "direction_count" integer DEFAULT 0 NOT NULL;