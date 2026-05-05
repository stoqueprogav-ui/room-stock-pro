-- Permite todos autenticados verem perfis (necessário para chat e descoberta de usuários)
DROP POLICY IF EXISTS profiles_select_self_or_master ON public.profiles;
CREATE POLICY profiles_select_authenticated
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);