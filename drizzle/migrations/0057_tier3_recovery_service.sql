CREATE TABLE IF NOT EXISTS "recovery_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "initiated_by_user_id" uuid NOT NULL,
  "recovery_type" text NOT NULL DEFAULT 'admin_reset',
  "status" text NOT NULL DEFAULT 'pending',
  "threshold" integer NOT NULL DEFAULT 2,
  "participants_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "expired_at" timestamptz,
  "new_device_id" text,
  "sigchain_entry_id" text
);
