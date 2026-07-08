
DROP POLICY IF EXISTS "Anyone can read games" ON public.games;
DROP POLICY IF EXISTS "Anyone can create games" ON public.games;
DROP POLICY IF EXISTS "Anyone can update games" ON public.games;

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.games FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.games FROM authenticated;

-- Table remains RLS-enabled with no policies: only service_role (via server functions) can access.
