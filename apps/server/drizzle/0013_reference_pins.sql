ALTER TABLE "board" ADD COLUMN "pins_for" text;--> statement-breakpoint
ALTER TABLE "reference" ADD COLUMN "plane" jsonb;--> statement-breakpoint
ALTER TABLE "board" ADD CONSTRAINT "board_pins_for_piece_id_fk" FOREIGN KEY ("pins_for") REFERENCES "public"."piece"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_pins_for_idx" ON "board" USING btree ("pins_for");