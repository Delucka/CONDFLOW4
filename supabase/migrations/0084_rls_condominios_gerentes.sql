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
CREATE POLICY "condominios_leitura" ON public.condominios
  FOR SELECT TO authenticated
  USING (
    public.papel_atual() IN (
      'master', 'departamento',
      'supervisora', 'supervisora_contabilidade', 'supervisor_gerentes'
    )
    OR id IN (SELECT condominio_id FROM public.condominios_da_carteira())
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
