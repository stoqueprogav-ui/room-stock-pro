CREATE TABLE IF NOT EXISTS public.notification_states (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_key text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  is_dismissed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_states TO authenticated;
GRANT ALL ON public.notification_states TO service_role;

ALTER TABLE public.notification_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own notification states"
  ON public.notification_states
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_notification_states_updated_at
  BEFORE UPDATE ON public.notification_states
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_notification_states_user ON public.notification_states(user_id);