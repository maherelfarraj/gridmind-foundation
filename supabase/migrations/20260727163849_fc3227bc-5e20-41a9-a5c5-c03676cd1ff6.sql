CREATE TABLE IF NOT EXISTS public.cron_probe (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fired_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.cron_probe TO authenticated;
GRANT ALL ON public.cron_probe TO service_role;
ALTER TABLE public.cron_probe ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated to read probe" ON public.cron_probe FOR SELECT TO authenticated USING (true);

SELECT cron.schedule(
  'cron-probe',
  '* * * * *',
  $$INSERT INTO public.cron_probe DEFAULT VALUES$$
);