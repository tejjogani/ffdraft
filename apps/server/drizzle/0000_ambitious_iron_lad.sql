CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_message" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"run_id" text,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_run" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"parent_run_id" text,
	"thread_id" text,
	"user_id" text NOT NULL,
	"piece_id" text,
	"base_seq" integer,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"tokens_cache_read" integer DEFAULT 0 NOT NULL,
	"tokens_cache_write" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_step" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"run_id" text NOT NULL,
	"idx" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"tool_call_id" text,
	"input" jsonb,
	"output" jsonb,
	"is_error" boolean DEFAULT false NOT NULL,
	"ms" integer DEFAULT 0 NOT NULL,
	"change_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"sha256" text NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"name" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_variant" (
	"org_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"variant" text NOT NULL,
	"sha256" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	CONSTRAINT "asset_variant_asset_id_variant_pk" PRIMARY KEY("asset_id","variant")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"action" text NOT NULL,
	"actor" jsonb NOT NULL,
	"user_id" text,
	"target_id" text,
	"input" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blob" (
	"org_id" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"mime" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blob_org_id_sha256_pk" PRIMARY KEY("org_id","sha256")
);
--> statement-breakpoint
CREATE TABLE "board" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"piece_id" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_model" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"card" jsonb NOT NULL,
	"portraits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attested_synthetic" boolean NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"position" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_change" (
	"id" text NOT NULL,
	"org_id" text NOT NULL,
	"piece_id" text NOT NULL,
	"seq" integer NOT NULL,
	"ops" jsonb NOT NULL,
	"inverse" jsonb NOT NULL,
	"actor" jsonb NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" text,
	"run_id" text,
	"tool_call_id" text,
	"label" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_change_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "model_shot" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"model_id" text NOT NULL,
	"piece_id" text NOT NULL,
	"asset_id" text,
	"placement" text NOT NULL,
	"direction" text DEFAULT '' NOT NULL,
	"fidelity" text NOT NULL,
	"status" text NOT NULL,
	"check" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"trace_retention_days" integer DEFAULT 90 NOT NULL,
	"allow_eval_use" boolean DEFAULT false NOT NULL,
	"assistant_model" text DEFAULT 'claude-opus-5-5' NOT NULL,
	"monthly_budget_usd" double precision,
	"welcome_seeded_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "piece" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"collection_id" text,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"stage" text NOT NULL,
	"brief" text DEFAULT '' NOT NULL,
	"spec" jsonb,
	"design" jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"cover_asset_id" text,
	"facts" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_package" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"piece_id" text NOT NULL,
	"revision" integer NOT NULL,
	"source_version" integer NOT NULL,
	"status" text NOT NULL,
	"asset_id" text,
	"manifest" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"board_id" text NOT NULL,
	"type" text NOT NULL,
	"asset_id" text,
	"thumb_url" text,
	"title" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"source" jsonb,
	"rights" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"palette" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generation" jsonb,
	"width" integer,
	"height" integer,
	"position" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "render_job" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"piece_id" text NOT NULL,
	"title" text NOT NULL,
	"scene" jsonb NOT NULL,
	"engine" text NOT NULL,
	"status" text NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"source_version" integer NOT NULL,
	"asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"actor" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "run_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"run_id" text NOT NULL,
	"step_id" text,
	"rating" text NOT NULL,
	"note" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"piece_id" text,
	"board_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_event" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"meter" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"quantity" double precision NOT NULL,
	"unit" text NOT NULL,
	"cost_micros" bigint NOT NULL,
	"user_id" text,
	"run_id" text,
	"piece_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_message" ADD CONSTRAINT "agent_message_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_message" ADD CONSTRAINT "agent_message_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_piece_id_piece_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."piece"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_step" ADD CONSTRAINT "agent_step_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_step" ADD CONSTRAINT "agent_step_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_variant" ADD CONSTRAINT "asset_variant_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_variant" ADD CONSTRAINT "asset_variant_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blob" ADD CONSTRAINT "blob_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board" ADD CONSTRAINT "board_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board" ADD CONSTRAINT "board_piece_id_piece_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."piece"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_model" ADD CONSTRAINT "brand_model_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_change" ADD CONSTRAINT "design_change_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_change" ADD CONSTRAINT "design_change_piece_id_piece_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."piece"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_shot" ADD CONSTRAINT "model_shot_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_shot" ADD CONSTRAINT "model_shot_model_id_brand_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."brand_model"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_shot" ADD CONSTRAINT "model_shot_piece_id_piece_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."piece"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piece" ADD CONSTRAINT "piece_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piece" ADD CONSTRAINT "piece_collection_id_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piece" ADD CONSTRAINT "piece_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_package" ADD CONSTRAINT "production_package_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_package" ADD CONSTRAINT "production_package_piece_id_piece_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."piece"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference" ADD CONSTRAINT "reference_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference" ADD CONSTRAINT "reference_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_job" ADD CONSTRAINT "render_job_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_job" ADD CONSTRAINT "render_job_piece_id_piece_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."piece"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_feedback" ADD CONSTRAINT "run_feedback_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_feedback" ADD CONSTRAINT "run_feedback_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_piece_id_piece_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."piece"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_org_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "member_org_user_idx" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "member_user_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "agent_message_thread_idx" ON "agent_message" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_run_org_idx" ON "agent_run" USING btree ("org_id","started_at");--> statement-breakpoint
CREATE INDEX "agent_run_piece_idx" ON "agent_run" USING btree ("piece_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_step_run_idx" ON "agent_step" USING btree ("run_id","idx");--> statement-breakpoint
CREATE INDEX "asset_org_idx" ON "asset" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_org_time_idx" ON "audit_log" USING btree ("org_id","at");--> statement-breakpoint
CREATE INDEX "board_org_idx" ON "board" USING btree ("org_id","updated_at");--> statement-breakpoint
CREATE INDEX "board_piece_idx" ON "board" USING btree ("piece_id");--> statement-breakpoint
CREATE INDEX "collection_org_idx" ON "collection" USING btree ("org_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "design_change_piece_seq_idx" ON "design_change" USING btree ("piece_id","seq");--> statement-breakpoint
CREATE INDEX "design_change_run_idx" ON "design_change" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "model_shot_org_idx" ON "model_shot" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "piece_org_updated_idx" ON "piece" USING btree ("org_id","updated_at");--> statement-breakpoint
CREATE INDEX "piece_collection_idx" ON "piece" USING btree ("collection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_package_piece_rev_idx" ON "production_package" USING btree ("piece_id","revision");--> statement-breakpoint
CREATE INDEX "reference_board_idx" ON "reference" USING btree ("board_id","position");--> statement-breakpoint
CREATE INDEX "render_job_org_idx" ON "render_job" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "render_job_piece_idx" ON "render_job" USING btree ("piece_id");--> statement-breakpoint
CREATE INDEX "thread_org_idx" ON "thread" USING btree ("org_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_event_idempotency_idx" ON "usage_event" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "usage_event_org_time_idx" ON "usage_event" USING btree ("org_id","occurred_at");