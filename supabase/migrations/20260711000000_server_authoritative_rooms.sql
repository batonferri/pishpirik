-- Server-authoritative rooms:
--  * games.state becomes PUBLIC state only (no hands, no deck order, no tokens)
--  * secrets (full game state + seat tokens) move to game_secrets (service_role only)
--  * optimistic-locking `version` column + transactional apply_game_update()
--  * clients lose INSERT/UPDATE/DELETE on games; SELECT stays for realtime
--  * per-seat heartbeat columns for disconnect/abandon detection

-- Old rows use the previous (insecure) state layout and cannot be upgraded.
DELETE FROM public.games;

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE public.game_secrets (
  game_id UUID PRIMARY KEY REFERENCES public.games (id) ON DELETE CASCADE,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  host_seen TIMESTAMPTZ,
  guest_seen TIMESTAMPTZ
);

ALTER TABLE public.game_secrets ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only service_role (server functions) may touch secrets.
REVOKE ALL ON public.game_secrets FROM anon, authenticated;
GRANT ALL ON public.game_secrets TO service_role;

-- Clients may only read the public row (needed for realtime postgres_changes).
DROP POLICY IF EXISTS "Anyone can create games" ON public.games;
DROP POLICY IF EXISTS "Anyone can update games" ON public.games;
REVOKE INSERT, UPDATE, DELETE ON public.games FROM anon, authenticated;
GRANT SELECT ON public.games TO anon, authenticated;
GRANT ALL ON public.games TO service_role;

-- Atomic compare-and-swap update of public + private state in one transaction.
CREATE OR REPLACE FUNCTION public.apply_game_update(
  p_id UUID,
  p_expected_version INTEGER,
  p_status TEXT,
  p_public JSONB,
  p_private JSONB
) RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_new INTEGER;
BEGIN
  UPDATE public.games
     SET status = p_status,
         state = p_public,
         version = version + 1
   WHERE id = p_id AND version = p_expected_version
  RETURNING version INTO v_new;

  IF v_new IS NULL THEN
    RAISE EXCEPTION 'VERSION_CONFLICT';
  END IF;

  UPDATE public.game_secrets
     SET state = p_private
   WHERE game_id = p_id;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_game_update(UUID, INTEGER, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_game_update(UUID, INTEGER, TEXT, JSONB, JSONB) TO service_role;
