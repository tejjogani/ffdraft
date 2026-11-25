CREATE TABLE "render_scene_change" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"scene_id" text NOT NULL,
	"seq" integer NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"actor" jsonb NOT NULL,
	"reverts" text,
	"reverted_by" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "render_job" ADD COLUMN "scene_hash" text;--> statement-breakpoint
ALTER TABLE "render_scene_change" ADD CONSTRAINT "render_scene_change_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_scene_change" ADD CONSTRAINT "render_scene_change_scene_id_render_scene_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."render_scene"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "render_scene_change_seq_idx" ON "render_scene_change" USING btree ("scene_id","seq");