ALTER TABLE "workspaces_memberships" ADD COLUMN IF NOT EXISTS "user_email" text;--> statement-breakpoint
ALTER TABLE "workspaces_memberships" ADD COLUMN IF NOT EXISTS "user_name" text;--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.workspaces_users') IS NOT NULL THEN
    UPDATE "workspaces_memberships" memberships
    SET
      "user_email" = users."email",
      "user_name" = users."name"
    FROM "workspaces_users" users
    WHERE memberships."user_id" = users."id"
      AND memberships."user_email" IS NULL;
  END IF;
END $$;--> statement-breakpoint
UPDATE "workspaces_memberships"
SET "user_email" = 'user-' || "user_id"::text || '@example.local'
WHERE "user_email" IS NULL;--> statement-breakpoint
ALTER TABLE "workspaces_memberships" ALTER COLUMN "user_email" SET NOT NULL;--> statement-breakpoint
DO $$
DECLARE
  constraint_name text;
  table_name text;
BEGIN
  FOR constraint_name, table_name IN
    SELECT tc.constraint_name, tc.table_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name IN ('workspaces_memberships', 'workspaces_invitations')
      AND ccu.table_name = 'workspaces_users'
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', table_name, constraint_name);
  END LOOP;
END $$;
