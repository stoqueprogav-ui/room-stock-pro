
DO $$
DECLARE
  v_uid UUID;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = 'luanbarretoandrade@hotmail.com';
  IF v_uid IS NULL THEN
    v_uid := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_uid, 'authenticated', 'authenticated',
      'luanbarretoandrade@hotmail.com',
      crypt('Tavia1991!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nome', 'Luan Barreto', 'role', 'master'),
      now(), now(), '', '', '', ''
    );
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_uid, v_uid::text,
            jsonb_build_object('sub', v_uid::text, 'email', 'luanbarretoandrade@hotmail.com', 'email_verified', true),
            'email', now(), now(), now());
  END IF;

  -- Garante profile e role master
  INSERT INTO public.profiles (id, nome, email, sala_id)
  VALUES (v_uid, 'Luan Barreto', 'luanbarretoandrade@hotmail.com', NULL)
  ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, email = EXCLUDED.email;

  INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'master')
  ON CONFLICT DO NOTHING;
END $$;
