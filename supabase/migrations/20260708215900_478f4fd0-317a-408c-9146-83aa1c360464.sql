
GRANT SELECT, INSERT, UPDATE ON public.games TO anon, authenticated;
GRANT ALL ON public.games TO service_role;

CREATE POLICY "Anyone can read games" ON public.games FOR SELECT USING (true);
CREATE POLICY "Anyone can create games" ON public.games FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update games" ON public.games FOR UPDATE USING (true) WITH CHECK (true);
