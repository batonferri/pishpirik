-- Public rooms: hosts can opt in to having their waiting room listed in the
-- lobby browser on the home page. Private rooms stay code-gated as before.

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;

-- The lobby only ever lists public rooms that are still waiting for a guest.
CREATE INDEX IF NOT EXISTS games_public_waiting_idx
  ON public.games (created_at DESC)
  WHERE is_public AND status = 'waiting';
