ALTER TABLE "agent_run" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "assistant_tier" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "assistant_models" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- An organisation that had chosen one of the tier models keeps it, as its Standard tier.
UPDATE "org_settings" SET "assistant_models" = jsonb_build_object('standard', "assistant_model") WHERE "assistant_model" IN ('claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5');