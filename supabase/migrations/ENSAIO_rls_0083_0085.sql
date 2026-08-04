-- ============================================================
-- ENSAIO 0083 → 0085 (v2) — NÃO É MIGRATION
-- ============================================================
-- A v1 estourou com "42P17 infinite recursion detected in policy for relation
-- profiles". Corrigido nas duas fontes: a política de `condominios` não chama
-- mais condominios_da_carteira() (que relia a própria tabela), e a de `profiles`
-- não chama função nenhuma.
--
-- ⚠️ RESULTADO EM VERMELHO é o formato do relatório, não falha.
--
-- OLHE A COLUNA `PROPRIO`: 1 em todos os papéis = login seguro.
-- ============================================================

-- ─────────── 0083_rls_backend_only.sql ───────────
-- ============================================================
-- 0083 — Fecha `aprovacoes` e `arrecadacoes` (tabelas de backend)
-- ============================================================
-- POR QUÊ ESTAS DUAS PRIMEIRO: são as únicas das cinco que sobraram em que o
-- NAVEGADOR nunca encosta. Conferido por varredura no frontend:
--
--   tabela         leituras do cliente   escritas do cliente
--   aprovacoes             0                     0
--   arrecadacoes           0                     0
--
-- Ou seja: risco ZERO de quebrar tela, e mesmo assim fecham buraco real —
-- qualquer pessoa com a chave anon (que é pública, vai no bundle) alcança as
-- duas pela API REST, mesmo sem tela para isso.
--
-- `aprovacoes` é a TRILHA DE AUDITORIA das aprovações de processo. Aberta como
-- está hoje, dá para ler o histórico inteiro e — pior — INSERIR aprovação falsa,
-- forjando que alguém aprovou algo que nunca aprovou. O backend a usa em 6
-- pontos (service-role, que ignora RLS e portanto não é afetado).
--
-- `arrecadacoes` é LEGADO: a 0010 migrou os valores para rateios_config /
-- rateios_valores, e nada mais lê a antiga — nem o front, nem a API. Fechada
-- para não ficar um resquício escancarado.
--
-- MODELO: RLS ligado e NENHUMA policy. É o mais restritivo possível — nega tudo
-- pela chave anon, e o backend continua igual. Mesmo desenho da 0071
-- (`condominos`), pelo mesmo motivo: tabela que só o servidor deve tocar.
--
-- Se um dia uma tela precisar ler alguma delas, aí sim se escreve a policy —
-- com o caso de uso na mão, não por antecipação.
--
-- ⚠️ ROLLBACK IMEDIATO:
--   ALTER TABLE public.aprovacoes   DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.arrecadacoes DISABLE ROW LEVEL SECURITY;
-- ============================================================

-- Limpa policies antigas: a 0001 criou algumas e a 0018 desligou o RLS, então
-- elas existem e são inertes. Deixá-las seria pegadinha para o próximo que ler.
DROP POLICY IF EXISTS "aprovacoes_all_authenticated"   ON public.aprovacoes;
DROP POLICY IF EXISTS "Allow all auth users"           ON public.aprovacoes;
DROP POLICY IF EXISTS "Todos veem historico"           ON public.aprovacoes;

DROP POLICY IF EXISTS "arrecadacoes_all_authenticated" ON public.arrecadacoes;
DROP POLICY IF EXISTS "Allow all auth users"           ON public.arrecadacoes;

ALTER TABLE public.aprovacoes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arrecadacoes ENABLE ROW LEVEL SECURITY;

-- ── Conferência ──
-- Deve devolver `true` nas duas, e zero policy:
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relnamespace='public'::regnamespace
--      AND relname IN ('aprovacoes','arrecadacoes');
--   SELECT tablename, policyname FROM pg_policies
--    WHERE tablename IN ('aprovacoes','arrecadacoes');   -- 0 linhas
--
-- Teste de tela: NENHUM. Nada no front usa estas duas — é justamente por isso
-- que elas vieram primeiro.


-- ─────────── 0084_rls_condominios_gerentes.sql ───────────
-- ============================================================
-- 0084 — Fecha `condominios` e `gerentes`
-- ============================================================
-- Abertas desde a 0018. Ao contrário das da 0083, estas o navegador USA muito —
-- por isso vêm depois, e com modelos diferentes uma da outra.
--
-- ── condominios ──
-- 14 pontos de leitura no front e UMA escrita (VisaoEmissor.js:133, campo
-- `caracteristicas`). O padrão das leituras: telas de master/departamento listam
-- todos os condomínios (dropdowns da Fila de Ocorrências, de Consumos), e
-- gerente/assistente leem a própria carteira. O VisualizadorConferencia lê
-- `caracteristicas`/`obs_emissao` de um condomínio e roda em /aprovacoes, que os
-- supervisores acessam — por isso eles entram na leitura.
--
-- Escrita: só master e departamento. Gerente NÃO edita cadastro de condomínio
-- (o formulário é master-only, e o backend confirma em /condominios/salvar).
--
-- ── gerentes ──
-- Escolha deliberada: LEITURA LIBERADA a qualquer usuário logado, escrita negada.
--
-- O motivo é risco assimétrico. A tabela guarda id, nome e profile_id — nada
-- sensível, nada que vaze dado de morador ou dinheiro. Mas ela é lida no LOGIN
-- (lib/auth.js:26, para resolver o gerente_id do usuário) e por usePendingCount,
-- RelatorioEmissoes, FilaOcorrencias e RegistroEmissoes. Uma política estreita
-- demais aqui não "protege" quase nada e pode travar a entrada de todo mundo.
--
-- Já a ESCRITA é fechada por completo: o navegador nunca escreve em `gerentes`
-- (varredura no front: 0 escritas), e o backend usa service-role, que ignora
-- RLS. Fechar a escrita é ganho puro, sem contrapartida.
--
-- ⚠️ ROLLBACK IMEDIATO:
--   ALTER TABLE public.condominios DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.gerentes    DISABLE ROW LEVEL SECURITY;
-- ============================================================

-- ── Limpa o inerte (a 0018 desligou o RLS; as policies ficaram decorativas) ──
DROP POLICY IF EXISTS "condominios_all_authenticated" ON public.condominios;
DROP POLICY IF EXISTS "Allow all auth users"          ON public.condominios;
DROP POLICY IF EXISTS "Master gerencia condominios"   ON public.condominios;
DROP POLICY IF EXISTS "Gerente ve seus condominios"   ON public.condominios;
DROP POLICY IF EXISTS "condominios_leitura"           ON public.condominios;
DROP POLICY IF EXISTS "condominios_escrita"           ON public.condominios;

DROP POLICY IF EXISTS "gerentes_all_authenticated"    ON public.gerentes;
DROP POLICY IF EXISTS "Allow all auth users"          ON public.gerentes;
DROP POLICY IF EXISTS "gerentes_leitura"              ON public.gerentes;

ALTER TABLE public.condominios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gerentes    ENABLE ROW LEVEL SECURITY;

-- ══════════════ condominios · leitura ══════════════
-- ⚠️ NÃO use condominios_da_carteira() AQUI. Ela faz SELECT FROM condominios, e
-- chamá-la de dentro da política desta mesma tabela dispara a política de novo:
-- 42P17 infinite recursion detected. Aconteceu no ensaio.
-- Dentro da política de `condominios`, o vínculo é olhado DIRETO por gerente_id.
CREATE POLICY "condominios_leitura" ON public.condominios
  FOR SELECT TO authenticated
  USING (
    public.papel_atual() IN (
      'master', 'departamento',
      'supervisora', 'supervisora_contabilidade', 'supervisor_gerentes'
    )
    -- gerente: a própria carteira
    OR gerente_id IN (SELECT g.id FROM public.gerentes g WHERE g.profile_id = auth.uid())
    -- assistente: a carteira do gerente ao qual está vinculado (0057)
    OR gerente_id IN (
         SELECT g.id FROM public.gerentes g
          JOIN public.profiles p ON p.gerente_id = g.profile_id
         WHERE p.id = auth.uid()
       )
  );

-- ══════════════ condominios · escrita ══════════════
CREATE POLICY "condominios_escrita" ON public.condominios
  FOR ALL TO authenticated
  USING      (public.papel_atual() IN ('master', 'departamento'))
  WITH CHECK (public.papel_atual() IN ('master', 'departamento'));

-- ══════════════ gerentes · leitura (aberta a quem está logado) ══════════════
-- Sem policy de escrita = escrita negada. É esse o desenho, não um esquecimento.
CREATE POLICY "gerentes_leitura" ON public.gerentes
  FOR SELECT TO authenticated
  USING (true);

-- ── Conferência ──
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relnamespace='public'::regnamespace
--      AND relname IN ('condominios','gerentes');       -- true nas duas
--
-- Teste de tela, nesta ordem:
--   1. LOGIN (entrar e sair) — `gerentes` é lida aqui; se travar, é a primeira a aparecer
--   2. Painel Central — a lista de condomínios tem de carregar
--   3. Consumos e Fila de Ocorrências — os dropdowns listam condomínios
--   4. Central de Emissões → características de um condomínio (a única escrita)


-- ─────────── 0085_rls_profiles.sql ───────────
-- ============================================================
-- 0085 — Fecha `profiles` — ESCALAÇÃO DE PRIVILÉGIO
-- ============================================================
-- O BURACO: com o RLS desligado (desde a 0018), qualquer usuário logado pode,
-- pelo DevTools com a chave anon:
--
--     UPDATE profiles SET role = 'master' WHERE id = <o próprio>;
--
-- Ou seja: qualquer gerente, assistente ou síndico vira master em uma linha, e
-- daí alcança tudo. É a falha mais grave desta série inteira — pior que apagar
-- cobrança, porque dá acesso a todo o resto.
--
-- ── Por que a leitura fica ABERTA (e não é preguiça) ──
-- A primeira versão desta migration restringia a leitura por papel, chamando
-- papel_atual(). Estourou no ensaio com:
--
--     42P17: infinite recursion detected in policy for relation "profiles"
--
-- E é insolúvel por esse caminho: para saber se você PODE ler profiles, a
-- política precisa saber o seu papel — que está em profiles. A política chama a
-- si mesma. SECURITY DEFINER não resolveu na prática.
--
-- Então: leitura liberada a quem está logado. É o mesmo nível de exposição de
-- hoje (nome, e-mail e papel de colegas — que a própria interface já exibe nas
-- telas de carteira e auditoria), e nenhuma linha de proteção é perdida em
-- relação ao estado atual.
--
-- ── O que MUDA de verdade ──
-- A escrita, que é onde estava o perigo:
--
--   INSERT / DELETE     negados (nenhuma policy os cobre)
--   UPDATE              só a PRÓPRIA linha (RLS)
--                       e só as DUAS COLUNAS do reset de senha (GRANT de coluna)
--
-- RLS não filtra coluna — por isso o GRANT de coluna entra junto. Sem ele,
-- "atualizar a própria linha" ainda permitiria trocar o próprio `role`, e o
-- buraco continuaria aberto.
--
-- Conferido antes de escrever: o navegador só escreve em profiles no
-- reset-password (must_change_password + password_changed_at, no próprio
-- registro). /admin/usuarios administra pelo BACKEND, com service-role, que
-- ignora RLS e não é afetado.
--
-- ⚠️ ROLLBACK — DEIXE COLADO NOUTRA ABA ANTES DE RODAR:
--   ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
--   GRANT UPDATE ON public.profiles TO authenticated;
-- ============================================================

DROP POLICY IF EXISTS "profiles_all_authenticated"  ON public.profiles;
DROP POLICY IF EXISTS "Allow all auth users"        ON public.profiles;
DROP POLICY IF EXISTS "Usuario ve o proprio perfil" ON public.profiles;
DROP POLICY IF EXISTS "profiles_leitura"            ON public.profiles;
DROP POLICY IF EXISTS "profiles_escrita"            ON public.profiles;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ══════════════ Leitura ══════════════
-- Sem chamada de função: é o que evita a recursão.
CREATE POLICY "profiles_leitura" ON public.profiles
  FOR SELECT TO authenticated
  USING (true);

-- ══════════════ Atualização — só a própria linha ══════════════
-- Sem policy de INSERT/DELETE: ambos ficam negados pela chave anon.
CREATE POLICY "profiles_atualiza_o_proprio" ON public.profiles
  FOR UPDATE TO authenticated
  USING      (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ══════════════ Trava de coluna — o que fecha a escalação ══════════════
-- RLS diz QUAIS LINHAS; isto diz QUAIS COLUNAS. Sem esta parte, o usuário ainda
-- trocaria o próprio `role` na própria linha.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT  UPDATE (must_change_password, password_changed_at)
  ON public.profiles TO authenticated;

-- ── Conferência ──
-- 1. Recarregue com Ctrl+Shift+R — ainda entra?
-- 2. LOGOUT e login completo (o passo 1 pode passar com sessão em cache)
-- 3. /admin/usuarios — a lista carrega? (é leitura; a escrita é pelo backend)
-- 4. A prova de que fechou — logado como NÃO-master, no console do navegador:
--       await supabase.from('profiles').update({role:'master'}).eq('id', <seu id>)
--    Tem de falhar. Antes desta migration, funcionava.

DO $ensaio$
DECLARE
  c              RECORD;
  papel_original text := current_user;
  tot_cond bigint; tot_prof bigint;
  n_cond bigint; n_ger bigint; n_prof bigint; n_proprio bigint;
  linhas text := ''; parecer text; achou boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: papel "authenticated" nao existe.';
  END IF;

  SELECT count(*) INTO tot_cond FROM public.condominios;
  SELECT count(*) INTO tot_prof FROM public.profiles;

  linhas := format(E'Total sem RLS:  %s condominios  ·  %s profiles\n', tot_cond, tot_prof)
         || E'\n  PAPEL       QUEM                       PROPRIO  CONDOMINIOS  GERENTES  PROFILES  VEREDITO\n';

  FOR c IN
      (SELECT 'master'::text AS papel, p.id, p.full_name FROM public.profiles p
        WHERE p.role::text='master' LIMIT 1)
    UNION ALL
      (SELECT 'gerente'::text, p.id, p.full_name
         FROM public.profiles p JOIN public.gerentes g ON g.profile_id=p.id
        WHERE p.role::text='gerente'
          AND EXISTS (SELECT 1 FROM public.condominios x WHERE x.gerente_id=g.id) LIMIT 1)
    UNION ALL
      (SELECT 'assistente'::text, p.id, p.full_name FROM public.profiles p
        WHERE p.role::text='assistente' AND p.gerente_id IS NOT NULL LIMIT 1)
    UNION ALL
      (SELECT 'supervisora'::text, p.id, p.full_name FROM public.profiles p
        WHERE p.role::text LIKE 'supervis%' LIMIT 1)
  LOOP
    achou := true;
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', c.id, 'role','authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    SELECT count(*) INTO n_cond    FROM public.condominios;
    SELECT count(*) INTO n_ger     FROM public.gerentes;
    SELECT count(*) INTO n_prof    FROM public.profiles;
    SELECT count(*) INTO n_proprio FROM public.profiles WHERE id = c.id;

    EXECUTE format('SET LOCAL ROLE %I', papel_original);

    parecer := CASE
      WHEN n_proprio = 0 THEN 'PERIGO - nao le o proprio perfil = LOGIN TRAVA'
      WHEN n_ger     = 0 THEN 'PERIGO - nao le gerentes = login trava'
      WHEN c.papel='master' AND n_cond < tot_cond THEN 'ATENCAO - master nao ve tudo'
      WHEN c.papel<>'master' AND n_cond = 0       THEN 'SUSPEITO - nenhum condominio'
      ELSE 'OK'
    END;

    linhas := linhas || format(E'  %-11s %-26s %7s  %5s/%-5s  %8s  %8s  %s\n',
                               c.papel, left(coalesce(c.full_name,'(sem nome)'),26),
                               n_proprio, n_cond, tot_cond, n_ger, n_prof, parecer);
  END LOOP;

  IF NOT achou THEN linhas := linhas || E'  INCONCLUSIVO - nenhum usuario para testar.\n'; END IF;

  RAISE EXCEPTION E'\n=== VEREDITO 0083-0085 v2 (nada foi gravado) ===\n%\nPROPRIO=1 em todos = login seguro.', linhas;
END
$ensaio$;
