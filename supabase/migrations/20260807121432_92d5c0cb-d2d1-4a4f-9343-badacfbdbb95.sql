REVOKE ALL ON TABLE public.portfolio_saved_views FROM anon;
REVOKE ALL ON TABLE public.portfolio_saved_views FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portfolio_saved_views TO authenticated;
GRANT ALL ON public.portfolio_saved_views TO service_role;