
-- Bucket público para o logo
INSERT INTO storage.buckets (id, name, public)
VALUES ('branding', 'branding', true)
ON CONFLICT (id) DO NOTHING;

-- Policies do bucket branding
CREATE POLICY "branding_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'branding');

CREATE POLICY "branding_master_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'branding' AND public.has_role(auth.uid(), 'master'));

CREATE POLICY "branding_master_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'branding' AND public.has_role(auth.uid(), 'master'));

CREATE POLICY "branding_master_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'branding' AND public.has_role(auth.uid(), 'master'));

-- Garantir registro de logo_url
INSERT INTO public.app_settings (key, value)
VALUES ('logo_url', '""'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Permitir leitura pública (anon) das configurações de branding (logo no login)
DROP POLICY IF EXISTS app_settings_public_read_branding ON public.app_settings;
CREATE POLICY "app_settings_public_read_branding"
ON public.app_settings FOR SELECT
TO anon
USING (key IN ('logo_url'));
