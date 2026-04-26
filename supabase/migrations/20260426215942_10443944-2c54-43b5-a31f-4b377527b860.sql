
-- ENUMS
CREATE TYPE public.app_role AS ENUM ('master', 'admin', 'analista');
CREATE TYPE public.solicitacao_status AS ENUM ('pendente', 'aprovado', 'rejeitado');
CREATE TYPE public.emprestimo_status AS ENUM ('pendente', 'aprovado', 'rejeitado');
CREATE TYPE public.movimentacao_tipo AS ENUM ('entrada', 'saida', 'ajuste', 'solicitacao', 'estorno', 'emprestimo_saida', 'emprestimo_entrada');

-- SALAS
CREATE TABLE public.salas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  sala_id UUID REFERENCES public.salas(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- USER ROLES
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- PRODUTOS
CREATE TABLE public.produtos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL UNIQUE,
  descricao TEXT,
  unidade TEXT NOT NULL DEFAULT 'un',
  estoque_minimo INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ESTOQUE (produto x sala)
CREATE TABLE public.estoque (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id UUID NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  sala_id UUID NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  quantidade INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (produto_id, sala_id)
);

-- SOLICITACOES (Admin/Analista -> Master)
CREATE TABLE public.solicitacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sala_id UUID NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  status public.solicitacao_status NOT NULL DEFAULT 'pendente',
  observacao TEXT,
  decidido_por UUID REFERENCES auth.users(id),
  decidido_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.solicitacao_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id UUID NOT NULL REFERENCES public.solicitacoes(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES public.produtos(id),
  quantidade INTEGER NOT NULL CHECK (quantidade > 0)
);

-- EMPRESTIMOS entre salas
CREATE TABLE public.emprestimos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitante_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sala_origem_id UUID NOT NULL REFERENCES public.salas(id),
  sala_destino_id UUID NOT NULL REFERENCES public.salas(id),
  status public.emprestimo_status NOT NULL DEFAULT 'pendente',
  observacao TEXT,
  decidido_por UUID REFERENCES auth.users(id),
  decidido_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (sala_origem_id <> sala_destino_id)
);

CREATE TABLE public.emprestimo_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emprestimo_id UUID NOT NULL REFERENCES public.emprestimos(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES public.produtos(id),
  quantidade INTEGER NOT NULL CHECK (quantidade > 0)
);

-- DIVIDAS entre salas
CREATE TABLE public.dividas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sala_devedora_id UUID NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  sala_credora_id UUID NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  saldo INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sala_devedora_id, sala_credora_id, produto_id),
  CHECK (sala_devedora_id <> sala_credora_id)
);

-- MOVIMENTACOES (log)
CREATE TABLE public.movimentacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id UUID NOT NULL REFERENCES public.produtos(id),
  sala_id UUID NOT NULL REFERENCES public.salas(id),
  usuario_id UUID REFERENCES auth.users(id),
  tipo public.movimentacao_tipo NOT NULL,
  quantidade INTEGER NOT NULL,
  saldo_apos INTEGER NOT NULL,
  referencia_tipo TEXT,
  referencia_id UUID,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_movimentacoes_sala ON public.movimentacoes(sala_id, created_at DESC);
CREATE INDEX idx_movimentacoes_produto ON public.movimentacoes(produto_id, created_at DESC);
CREATE INDEX idx_estoque_sala ON public.estoque(sala_id);
CREATE INDEX idx_solicitacoes_sala ON public.solicitacoes(sala_id, created_at DESC);
CREATE INDEX idx_emprestimos_destino ON public.emprestimos(sala_destino_id);
CREATE INDEX idx_emprestimos_origem ON public.emprestimos(sala_origem_id);

-- ====== FUNCTIONS ======

-- has_role (security definer, evita recursão de RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- get_user_sala
CREATE OR REPLACE FUNCTION public.get_user_sala(_user_id UUID)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sala_id FROM public.profiles WHERE id = _user_id
$$;

-- handle_new_user: cria profile automaticamente no signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, email, sala_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)),
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'sala_id', '')::UUID
  )
  ON CONFLICT (id) DO NOTHING;

  -- Se metadados trazem o role, aplica; senão, default analista
  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'role', ''), 'analista')::public.app_role
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- update timestamp trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_produtos_updated BEFORE UPDATE ON public.produtos
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_estoque_updated BEFORE UPDATE ON public.estoque
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_dividas_updated BEFORE UPDATE ON public.dividas
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Quando um produto é criado, cria linha de estoque=0 para todas as salas
CREATE OR REPLACE FUNCTION public.seed_estoque_for_new_produto()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.estoque (produto_id, sala_id, quantidade)
  SELECT NEW.id, s.id, 0 FROM public.salas s
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_produto_seed_estoque AFTER INSERT ON public.produtos
FOR EACH ROW EXECUTE FUNCTION public.seed_estoque_for_new_produto();

-- Quando uma sala é criada, cria linha de estoque=0 para todos os produtos
CREATE OR REPLACE FUNCTION public.seed_estoque_for_new_sala()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.estoque (produto_id, sala_id, quantidade)
  SELECT p.id, NEW.id, 0 FROM public.produtos p
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_sala_seed_estoque AFTER INSERT ON public.salas
FOR EACH ROW EXECUTE FUNCTION public.seed_estoque_for_new_sala();

-- ====== ENABLE RLS ======
ALTER TABLE public.salas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitacao_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emprestimos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emprestimo_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dividas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimentacoes ENABLE ROW LEVEL SECURITY;

-- ====== RLS POLICIES ======

-- SALAS: todos autenticados podem ler; só master altera
CREATE POLICY "salas_select_authenticated" ON public.salas FOR SELECT TO authenticated USING (true);
CREATE POLICY "salas_master_all" ON public.salas FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'master')) WITH CHECK (public.has_role(auth.uid(), 'master'));

-- PROFILES: usuário lê o próprio; master lê todos
CREATE POLICY "profiles_select_self_or_master" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'master'));
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_master_all" ON public.profiles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'master')) WITH CHECK (public.has_role(auth.uid(), 'master'));

-- USER_ROLES: usuário lê o próprio; master gerencia tudo
CREATE POLICY "roles_select_self_or_master" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'master'));
CREATE POLICY "roles_master_all" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'master')) WITH CHECK (public.has_role(auth.uid(), 'master'));

-- PRODUTOS: todos autenticados leem; só master altera
CREATE POLICY "produtos_select_authenticated" ON public.produtos FOR SELECT TO authenticated USING (true);
CREATE POLICY "produtos_master_all" ON public.produtos FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'master')) WITH CHECK (public.has_role(auth.uid(), 'master'));

-- ESTOQUE: master vê tudo; demais veem só da própria sala. Master altera; demais não escrevem direto (via RPCs SECURITY DEFINER)
CREATE POLICY "estoque_select_master_or_sala" ON public.estoque FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'master') OR sala_id = public.get_user_sala(auth.uid()));
CREATE POLICY "estoque_master_write" ON public.estoque FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'master')) WITH CHECK (public.has_role(auth.uid(), 'master'));

-- SOLICITACOES: master vê todas; demais veem da própria sala
CREATE POLICY "solic_select_master_or_sala" ON public.solicitacoes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'master') OR sala_id = public.get_user_sala(auth.uid()));
CREATE POLICY "solic_insert_user_sala" ON public.solicitacoes FOR INSERT TO authenticated
  WITH CHECK (usuario_id = auth.uid() AND sala_id = public.get_user_sala(auth.uid()));
CREATE POLICY "solic_master_update" ON public.solicitacoes FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'master')) WITH CHECK (public.has_role(auth.uid(), 'master'));
CREATE POLICY "solic_master_delete" ON public.solicitacoes FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'master'));

-- SOLICITACAO_ITENS: ligado à solicitação
CREATE POLICY "solic_itens_select" ON public.solicitacao_itens FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.solicitacoes s WHERE s.id = solicitacao_id
    AND (public.has_role(auth.uid(), 'master') OR s.sala_id = public.get_user_sala(auth.uid()))
  ));
CREATE POLICY "solic_itens_insert" ON public.solicitacao_itens FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.solicitacoes s WHERE s.id = solicitacao_id
    AND s.usuario_id = auth.uid() AND s.sala_id = public.get_user_sala(auth.uid())
  ));

-- EMPRESTIMOS: master vê todos; sala envolvida (origem ou destino) vê seus
CREATE POLICY "emp_select_master_or_envolvido" ON public.emprestimos FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'master')
    OR sala_origem_id = public.get_user_sala(auth.uid())
    OR sala_destino_id = public.get_user_sala(auth.uid())
  );
-- O empréstimo é solicitado pela sala DESTINO (que precisa do produto) à sala ORIGEM (que cede)
CREATE POLICY "emp_insert_user_sala_destino" ON public.emprestimos FOR INSERT TO authenticated
  WITH CHECK (solicitante_id = auth.uid() AND sala_destino_id = public.get_user_sala(auth.uid()));
CREATE POLICY "emp_update_master_or_admin_origem" ON public.emprestimos FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'master')
    OR (public.has_role(auth.uid(), 'admin') AND sala_origem_id = public.get_user_sala(auth.uid()))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'master')
    OR (public.has_role(auth.uid(), 'admin') AND sala_origem_id = public.get_user_sala(auth.uid()))
  );
CREATE POLICY "emp_master_delete" ON public.emprestimos FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'master'));

CREATE POLICY "emp_itens_select" ON public.emprestimo_itens FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.emprestimos e WHERE e.id = emprestimo_id
    AND (
      public.has_role(auth.uid(), 'master')
      OR e.sala_origem_id = public.get_user_sala(auth.uid())
      OR e.sala_destino_id = public.get_user_sala(auth.uid())
    )
  ));
CREATE POLICY "emp_itens_insert" ON public.emprestimo_itens FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.emprestimos e WHERE e.id = emprestimo_id
    AND e.solicitante_id = auth.uid() AND e.sala_destino_id = public.get_user_sala(auth.uid())
  ));

-- DIVIDAS: master vê tudo; sala envolvida vê suas
CREATE POLICY "dividas_select_envolvidos" ON public.dividas FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'master')
    OR sala_devedora_id = public.get_user_sala(auth.uid())
    OR sala_credora_id = public.get_user_sala(auth.uid())
  );
CREATE POLICY "dividas_master_all" ON public.dividas FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'master')) WITH CHECK (public.has_role(auth.uid(), 'master'));

-- MOVIMENTACOES: master vê tudo; demais só da própria sala (read-only)
CREATE POLICY "mov_select_master_or_sala" ON public.movimentacoes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'master') OR sala_id = public.get_user_sala(auth.uid()));

-- ====== RPCs (regras de negócio com SECURITY DEFINER) ======

-- Cria solicitação ao master, dando baixa imediata no estoque
CREATE OR REPLACE FUNCTION public.criar_solicitacao(_itens JSONB, _observacao TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_sala UUID;
  v_solic UUID;
  v_item JSONB;
  v_pid UUID;
  v_qtd INTEGER;
  v_saldo INTEGER;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  v_sala := public.get_user_sala(v_user);
  IF v_sala IS NULL THEN RAISE EXCEPTION 'usuário sem sala'; END IF;

  INSERT INTO public.solicitacoes (usuario_id, sala_id, observacao)
  VALUES (v_user, v_sala, _observacao) RETURNING id INTO v_solic;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    v_pid := (v_item->>'produto_id')::UUID;
    v_qtd := (v_item->>'quantidade')::INTEGER;
    IF v_qtd <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;

    -- baixa imediata
    UPDATE public.estoque SET quantidade = quantidade - v_qtd
    WHERE produto_id = v_pid AND sala_id = v_sala
    RETURNING quantidade INTO v_saldo;

    IF v_saldo IS NULL THEN RAISE EXCEPTION 'produto não existe no estoque da sala'; END IF;
    IF v_saldo < 0 THEN RAISE EXCEPTION 'estoque insuficiente'; END IF;

    INSERT INTO public.solicitacao_itens (solicitacao_id, produto_id, quantidade)
    VALUES (v_solic, v_pid, v_qtd);

    INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id)
    VALUES (v_pid, v_sala, v_user, 'solicitacao', -v_qtd, v_saldo, 'solicitacao', v_solic);
  END LOOP;

  RETURN v_solic;
END;
$$;

-- Decisão do master sobre solicitação. Aprovar = só registra. Rejeitar = estorna.
CREATE OR REPLACE FUNCTION public.decidir_solicitacao(_solic UUID, _aprovar BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_sala UUID;
  v_status public.solicitacao_status;
  v_item RECORD;
  v_saldo INTEGER;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;

  SELECT status, sala_id INTO v_status, v_sala FROM public.solicitacoes WHERE id = _solic;
  IF v_status IS NULL THEN RAISE EXCEPTION 'solicitação não encontrada'; END IF;
  IF v_status <> 'pendente' THEN RAISE EXCEPTION 'solicitação já decidida'; END IF;

  IF _aprovar THEN
    UPDATE public.solicitacoes SET status='aprovado', decidido_por=v_user, decidido_em=now() WHERE id=_solic;
  ELSE
    -- estorna
    FOR v_item IN SELECT produto_id, quantidade FROM public.solicitacao_itens WHERE solicitacao_id=_solic LOOP
      UPDATE public.estoque SET quantidade = quantidade + v_item.quantidade
      WHERE produto_id = v_item.produto_id AND sala_id = v_sala
      RETURNING quantidade INTO v_saldo;

      INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id, observacao)
      VALUES (v_item.produto_id, v_sala, v_user, 'estorno', v_item.quantidade, v_saldo, 'solicitacao', _solic, 'estorno por rejeição');
    END LOOP;
    UPDATE public.solicitacoes SET status='rejeitado', decidido_por=v_user, decidido_em=now() WHERE id=_solic;
  END IF;
END;
$$;

-- Criar pedido de empréstimo (sala destino solicita à sala origem). Sem baixa.
CREATE OR REPLACE FUNCTION public.criar_emprestimo(_sala_origem UUID, _itens JSONB, _observacao TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_sala_destino UUID;
  v_emp UUID;
  v_item JSONB;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  v_sala_destino := public.get_user_sala(v_user);
  IF v_sala_destino IS NULL THEN RAISE EXCEPTION 'usuário sem sala'; END IF;
  IF v_sala_destino = _sala_origem THEN RAISE EXCEPTION 'salas iguais'; END IF;

  INSERT INTO public.emprestimos (solicitante_id, sala_origem_id, sala_destino_id, observacao)
  VALUES (v_user, _sala_origem, v_sala_destino, _observacao) RETURNING id INTO v_emp;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    INSERT INTO public.emprestimo_itens (emprestimo_id, produto_id, quantidade)
    VALUES (v_emp, (v_item->>'produto_id')::UUID, (v_item->>'quantidade')::INTEGER);
  END LOOP;

  RETURN v_emp;
END;
$$;

-- Decisão sobre empréstimo. Aprovar = baixa origem + entrada destino + dívida.
CREATE OR REPLACE FUNCTION public.decidir_emprestimo(_emp UUID, _aprovar BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_origem UUID;
  v_destino UUID;
  v_status public.emprestimo_status;
  v_item RECORD;
  v_saldo_origem INTEGER;
  v_saldo_destino INTEGER;
  v_user_sala UUID;
BEGIN
  SELECT sala_origem_id, sala_destino_id, status INTO v_origem, v_destino, v_status
  FROM public.emprestimos WHERE id = _emp;
  IF v_status IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
  IF v_status <> 'pendente' THEN RAISE EXCEPTION 'empréstimo já decidido'; END IF;

  v_user_sala := public.get_user_sala(v_user);
  IF NOT (public.has_role(v_user, 'master')
          OR (public.has_role(v_user, 'admin') AND v_user_sala = v_origem)) THEN
    RAISE EXCEPTION 'sem permissão para decidir este empréstimo';
  END IF;

  IF NOT _aprovar THEN
    UPDATE public.emprestimos SET status='rejeitado', decidido_por=v_user, decidido_em=now() WHERE id=_emp;
    RETURN;
  END IF;

  FOR v_item IN SELECT produto_id, quantidade FROM public.emprestimo_itens WHERE emprestimo_id = _emp LOOP
    -- baixa origem
    UPDATE public.estoque SET quantidade = quantidade - v_item.quantidade
    WHERE produto_id = v_item.produto_id AND sala_id = v_origem
    RETURNING quantidade INTO v_saldo_origem;
    IF v_saldo_origem IS NULL THEN RAISE EXCEPTION 'produto sem estoque registrado na origem'; END IF;
    IF v_saldo_origem < 0 THEN RAISE EXCEPTION 'estoque insuficiente na sala origem'; END IF;

    INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id)
    VALUES (v_item.produto_id, v_origem, v_user, 'emprestimo_saida', -v_item.quantidade, v_saldo_origem, 'emprestimo', _emp);

    -- entrada destino
    UPDATE public.estoque SET quantidade = quantidade + v_item.quantidade
    WHERE produto_id = v_item.produto_id AND sala_id = v_destino
    RETURNING quantidade INTO v_saldo_destino;
    IF v_saldo_destino IS NULL THEN
      INSERT INTO public.estoque (produto_id, sala_id, quantidade) VALUES (v_item.produto_id, v_destino, v_item.quantidade)
      RETURNING quantidade INTO v_saldo_destino;
    END IF;

    INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id)
    VALUES (v_item.produto_id, v_destino, v_user, 'emprestimo_entrada', v_item.quantidade, v_saldo_destino, 'emprestimo', _emp);

    -- dívida: destino deve à origem
    INSERT INTO public.dividas (sala_devedora_id, sala_credora_id, produto_id, saldo)
    VALUES (v_destino, v_origem, v_item.produto_id, v_item.quantidade)
    ON CONFLICT (sala_devedora_id, sala_credora_id, produto_id)
    DO UPDATE SET saldo = public.dividas.saldo + EXCLUDED.saldo, updated_at = now();
  END LOOP;

  UPDATE public.emprestimos SET status='aprovado', decidido_por=v_user, decidido_em=now() WHERE id=_emp;
END;
$$;

-- Master ajusta estoque manualmente (com log)
CREATE OR REPLACE FUNCTION public.ajustar_estoque(_produto UUID, _sala UUID, _quantidade INTEGER, _observacao TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_atual INTEGER;
  v_diff INTEGER;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  SELECT quantidade INTO v_atual FROM public.estoque WHERE produto_id=_produto AND sala_id=_sala;
  IF v_atual IS NULL THEN
    INSERT INTO public.estoque (produto_id, sala_id, quantidade) VALUES (_produto, _sala, _quantidade);
    v_diff := _quantidade;
    v_atual := _quantidade;
  ELSE
    v_diff := _quantidade - v_atual;
    UPDATE public.estoque SET quantidade=_quantidade WHERE produto_id=_produto AND sala_id=_sala;
    v_atual := _quantidade;
  END IF;
  INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, observacao)
  VALUES (_produto, _sala, v_user, 'ajuste', v_diff, v_atual, _observacao);
  RETURN v_atual;
END;
$$;

-- Master quita dívida (parcial ou total)
CREATE OR REPLACE FUNCTION public.quitar_divida(_divida UUID, _quantidade INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_saldo INTEGER;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  SELECT saldo INTO v_saldo FROM public.dividas WHERE id=_divida;
  IF v_saldo IS NULL THEN RAISE EXCEPTION 'dívida não encontrada'; END IF;
  IF _quantidade <= 0 OR _quantidade > v_saldo THEN RAISE EXCEPTION 'quantidade inválida'; END IF;
  IF _quantidade = v_saldo THEN
    DELETE FROM public.dividas WHERE id=_divida;
  ELSE
    UPDATE public.dividas SET saldo = saldo - _quantidade, updated_at = now() WHERE id=_divida;
  END IF;
END;
$$;

-- Seed das 5 salas iniciais
INSERT INTO public.salas (nome) VALUES
  ('Matriz'),
  ('Parque Luguito'),
  ('Casa Lugano'),
  ('Hortênsias'),
  ('NASA');
