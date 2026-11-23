CREATE TABLE "mesh_job" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"piece_id" text NOT NULL,
	"status" text NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"quality" text NOT NULL,
	"input_asset_ids" jsonb NOT NULL,
	"mesh_asset_id" text,
	"provider_job_id" text,
	"cost_micros" bigint,
	"error" text,
	"actor" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "render_scene" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"piece_id" text,
	"title" text NOT NULL,
	"scene" jsonb NOT NULL,
	"position" double precision NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_settings" ALTER COLUMN "assistant_model" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "org_settings" ALTER COLUMN "assistant_model" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "run_feedback" ALTER COLUMN "rating" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "run_feedback" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_message" ADD COLUMN "seq" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_message" ADD COLUMN "client_message_id" text;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "origin" text DEFAULT 'studio' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "agent_step" ADD COLUMN "status" text DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_step" ADD COLUMN "approval" jsonb;--> statement-breakpoint
ALTER TABLE "agent_step" ADD COLUMN "usage" jsonb;--> statement-breakpoint
ALTER TABLE "agent_step" ADD COLUMN "stop_reason" text;--> statement-breakpoint
ALTER TABLE "brand_model" ADD COLUMN "recipe" jsonb;--> statement-breakpoint
ALTER TABLE "brand_model" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_model" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "brand_model" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "design_change" ADD COLUMN "reverts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "model_shot" ADD COLUMN "aspect" text DEFAULT '4:5' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_shot" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "model_shot" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_shot" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "model_shot" ADD COLUMN "source_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_shot" ADD COLUMN "model_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_shot" ADD COLUMN "provenance" jsonb;--> statement-breakpoint
ALTER TABLE "model_shot" ADD COLUMN "actor" jsonb;--> statement-breakpoint
ALTER TABLE "piece" ADD COLUMN "cover_auto" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "piece" ADD COLUMN "origin" jsonb;--> statement-breakpoint
ALTER TABLE "reference" ADD COLUMN "piece_id" text;--> statement-breakpoint
ALTER TABLE "reference" ADD COLUMN "canvas" jsonb;--> statement-breakpoint
ALTER TABLE "render_job" ADD COLUMN "requested_scene" jsonb;--> statement-breakpoint
ALTER TABLE "render_job" ADD COLUMN "scene_id" text;--> statement-breakpoint
ALTER TABLE "render_job" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "render_job" ADD COLUMN "variant_label" text;--> statement-breakpoint
ALTER TABLE "render_job" ADD COLUMN "purpose" text DEFAULT 'take' NOT NULL;--> statement-breakpoint
ALTER TABLE "render_job" ADD COLUMN "auto_tune" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "render_job" ADD COLUMN "critique" jsonb;--> statement-breakpoint
ALTER TABLE "render_job" ADD COLUMN "retry_of" text;--> statement-breakpoint
ALTER TABLE "render_job" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "render_job" ADD COLUMN "starred" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "render_job" ADD COLUMN "seconds" double precision;--> statement-breakpoint
ALTER TABLE "render_job" ADD COLUMN "device" text;--> statement-breakpoint
ALTER TABLE "render_job" ADD COLUMN "cache_key" text;--> statement-breakpoint
ALTER TABLE "render_job" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "run_feedback" ADD COLUMN "source" text DEFAULT 'explicit' NOT NULL;--> statement-breakpoint
ALTER TABLE "run_feedback" ADD COLUMN "kind" text NOT NULL;--> statement-breakpoint
ALTER TABLE "run_feedback" ADD COLUMN "change_id" text;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "scene_id" text;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "prompt_hash" text;--> statement-breakpoint
ALTER TABLE "mesh_job" ADD CONSTRAINT "mesh_job_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mesh_job" ADD CONSTRAINT "mesh_job_piece_id_piece_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."piece"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_scene" ADD CONSTRAINT "render_scene_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_scene" ADD CONSTRAINT "render_scene_piece_id_piece_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."piece"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mesh_job_piece_idx" ON "mesh_job" USING btree ("org_id","piece_id","created_at");--> statement-breakpoint
CREATE INDEX "render_scene_piece_idx" ON "render_scene" USING btree ("org_id","piece_id","position");--> statement-breakpoint
ALTER TABLE "reference" ADD CONSTRAINT "reference_piece_id_piece_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."piece"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_job" ADD CONSTRAINT "render_job_scene_id_render_scene_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."render_scene"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_scene_id_render_scene_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."render_scene"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_message_seq_idx" ON "agent_message" USING btree ("thread_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_message_client_idx" ON "agent_message" USING btree ("org_id","client_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_step_tool_call_idx" ON "agent_step" USING btree ("run_id","tool_call_id");