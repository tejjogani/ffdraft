CREATE TABLE "image_brief" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"board_id" text NOT NULL,
	"user_id" text NOT NULL,
	"run_id" text,
	"request" text NOT NULL,
	"mode" text NOT NULL,
	"parent_id" text,
	"reference_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verdict" text NOT NULL,
	"category" text,
	"reason" text NOT NULL,
	"rights_subject" text,
	"attestation" jsonb,
	"understanding" text NOT NULL,
	"piece" jsonb NOT NULL,
	"prompt" text NOT NULL,
	"aspect" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"claude_model" text NOT NULL,
	"claude_micros" bigint DEFAULT 0 NOT NULL,
	"decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generations" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_key" (
	"org_id" text NOT NULL,
	"provider" text NOT NULL,
	"sealed" text NOT NULL,
	"last4" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_key_org_id_provider_pk" PRIMARY KEY("org_id","provider")
);
--> statement-breakpoint
ALTER TABLE "board" ADD COLUMN "image_provider" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "image_provider" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "image_quality" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "image_models" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "image_brief" ADD CONSTRAINT "image_brief_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_brief" ADD CONSTRAINT "image_brief_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_key" ADD CONSTRAINT "image_key_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_brief_board_idx" ON "image_brief" USING btree ("board_id","created_at");