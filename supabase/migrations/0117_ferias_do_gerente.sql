-- ============================================================================
-- 0117 — Férias do gerente: a carteira responde por alguém enquanto ele não está
-- ============================================================================
--
-- O PROBLEMA. A aprovação da emissão é do gerente da carteira — e só dele. Em
-- férias, a carteira inteira para: ninguém mais enxerga aqueles condomínios,
-- porque tanto a tela quanto o RLS (0103) resolvem carteira por
-- `gerentes.profile_id = auth.uid()`. O mês vira e as emissões ficam sem
-- aprovação, sem que ninguém sequer saiba quais são.
--
-- O DESENHO, em duas tabelas:
--
--   gerente_ausencias              QUEM se ausenta, POR QUE e ENTRE QUAIS DATAS
--   gerente_ausencia_condominios   QUAL condomínio responde a QUAL substituto
--
-- A segunda é o que torna a divisão real: um condomínio tem exatamente um
-- responsável no período (UNIQUE), então nunca há dúvida sobre de quem é a vez
-- — e dois substitutos não tropeçam no mesmo pacote.
--
-- O FIM DO PERÍODO NÃO PRECISA DE ROTINA. O acesso é calculado por data
-- (`current_date BETWEEN`), então no dia seguinte ao fim ele deixa de valer
-- sozinho: some da tela do substituto e volta para o gerente. As linhas ficam —
-- viram o histórico de quem respondeu por quem, e quando.
--
-- O QUE FOI APROVADO CONTINUA APROVADO. A aprovação vive na trilha
-- (`emissoes_pacotes_aprovacoes`) e no status do pacote; nada aqui a desfaz. O
-- que sobrar volta a aparecer para o gerente.
--
-- E A TRILHA PASSA A DIZER POR QUÊ. Duas colunas novas guardam o contexto:
-- "aprovado por Denner · férias da Suellen". Sem isso, daqui a seis meses a
-- assinatura de um master numa carteira que não é dele vira um mistério.
--
-- ROLLBACK no fim do arquivo.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.gerente_ausencias (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gerente_id      uuid NOT NULL REFERENCES public.gerentes(id) ON DELETE CASCADE,
  motivo          text NOT NULL DEFAULT 'Férias',
  data_inicio     date NOT NULL,
  data_fim        date NOT NULL,
  encerrada_em    timestamptz,
  criado_por      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  criado_por_nome text,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ausencia_periodo_valido CHECK (data_fim >= data_inicio)
);

COMMENT ON TABLE public.gerente_ausencias IS
  'Periodo em que a carteira de um gerente responde por outras pessoas. Encerra sozinho na data_fim.';
COMMENT ON COLUMN public.gerente_ausencias.motivo IS
  'Aparece na trilha de aprovacao: "aprovado por Denner - ferias da Suellen".';
COMMENT ON COLUMN public.gerente_ausencias.encerrada_em IS
  'Preenchida so quando alguem encerra ANTES da data_fim (voltou antes das ferias acabarem).';


CREATE TABLE IF NOT EXISTS public.gerente_ausencia_condominios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ausencia_id   uuid NOT NULL REFERENCES public.gerente_ausencias(id) ON DELETE CASCADE,
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  substituto_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Um condominio, um responsavel. E o que impede dois substitutos de acharem
  -- que o outro vai aprovar.
  CONSTRAINT ausencia_condo_unico UNIQUE (ausencia_id, condominio_id)
);

CREATE INDEX IF NOT EXISTS idx_ausencia_condo_substituto
  ON public.gerente_ausencia_condominios(substituto_id);
CREATE INDEX IF NOT EXISTS idx_ausencia_periodo
  ON public.gerente_ausencias(data_inicio, data_fim) WHERE encerrada_em IS NULL;


-- ── O contexto da assinatura ────────────────────────────────────────────────
ALTER TABLE public.emissoes_pacotes_aprovacoes
  ADD COLUMN IF NOT EXISTS em_nome_de text,
  ADD COLUMN IF NOT EXISTS motivo     text;

COMMENT ON COLUMN public.emissoes_pacotes_aprovacoes.em_nome_de IS
  'Nome do gerente ausente, quando quem assinou estava cobrindo a carteira dele.';


-- ── Quais condominios eu respondo HOJE por ausencia de alguem ───────────────
-- SECURITY DEFINER porque e usada dentro de politica de RLS: precisa ler as
-- tabelas de ausencia sem esbarrar na politica delas.
CREATE OR REPLACE FUNCTION public.condominios_por_ausencia()
RETURNS TABLE (condominio_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT ac.condominio_id
    FROM public.gerente_ausencia_condominios ac
    JOIN public.gerente_ausencias a ON a.id = ac.ausencia_id
   WHERE ac.substituto_id = auth.uid()
     AND a.encerrada_em IS NULL
     AND current_date BETWEEN a.data_inicio AND a.data_fim;
$fn$;

REVOKE ALL ON FUNCTION public.condominios_por_ausencia() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.condominios_por_ausencia() TO authenticated;


-- ── RLS das proprias tabelas ────────────────────────────────────────────────
-- Leitura para quem esta autenticado: o substituto precisa saber de quem e a
-- carteira que apareceu na tela dele. Escrita so pela API com service role —
-- sem policy de escrita, o banco nega.
ALTER TABLE public.gerente_ausencias            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gerente_ausencia_condominios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ausencias_leitura ON public.gerente_ausencias;
CREATE POLICY ausencias_leitura ON public.gerente_ausencias
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS ausencia_condos_leitura ON public.gerente_ausencia_condominios;
CREATE POLICY ausencia_condos_leitura ON public.gerente_ausencia_condominios
  FOR SELECT TO authenticated USING (true);


-- ── O RLS de emissoes passa a enxergar a substituicao ───────────────────────
-- Sem isto, o substituto ve o condominio na tela e o banco recusa a aprovacao:
-- a carteira em `pacotes_carteira` (0103) e resolvida so por
-- `gerentes.profile_id = auth.uid()`.
DROP POLICY IF EXISTS pacotes_carteira ON public.emissoes_pacotes;
CREATE POLICY pacotes_carteira ON public.emissoes_pacotes
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM condominios c
     WHERE c.id = emissoes_pacotes.condominio_id
       AND (c.gerente_id IN (SELECT g.id FROM gerentes g WHERE g.profile_id = auth.uid())
         OR c.gerente_id IN (SELECT g.id FROM gerentes g
                               JOIN profiles p ON p.gerente_id = g.profile_id
                              WHERE p.id = auth.uid())))
    OR emissoes_pacotes.condominio_id IN (SELECT condominio_id FROM public.condominios_por_ausencia()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM condominios c
     WHERE c.id = emissoes_pacotes.condominio_id
       AND (c.gerente_id IN (SELECT g.id FROM gerentes g WHERE g.profile_id = auth.uid())
         OR c.gerente_id IN (SELECT g.id FROM gerentes g
                               JOIN profiles p ON p.gerente_id = g.profile_id
                              WHERE p.id = auth.uid())))
    OR emissoes_pacotes.condominio_id IN (SELECT condominio_id FROM public.condominios_por_ausencia()));

DROP POLICY IF EXISTS arquivos_carteira ON public.emissoes_arquivos;
CREATE POLICY arquivos_carteira ON public.emissoes_arquivos
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM condominios c
     WHERE c.id = emissoes_arquivos.condominio_id
       AND (c.gerente_id IN (SELECT g.id FROM gerentes g WHERE g.profile_id = auth.uid())
         OR c.gerente_id IN (SELECT g.id FROM gerentes g
                               JOIN profiles p ON p.gerente_id = g.profile_id
                              WHERE p.id = auth.uid())))
    OR emissoes_arquivos.condominio_id IN (SELECT condominio_id FROM public.condominios_por_ausencia()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM condominios c
     WHERE c.id = emissoes_arquivos.condominio_id
       AND (c.gerente_id IN (SELECT g.id FROM gerentes g WHERE g.profile_id = auth.uid())
         OR c.gerente_id IN (SELECT g.id FROM gerentes g
                               JOIN profiles p ON p.gerente_id = g.profile_id
                              WHERE p.id = auth.uid())))
    OR emissoes_arquivos.condominio_id IN (SELECT condominio_id FROM public.condominios_por_ausencia()));

-- E a leitura do condominio, senao o substituto ve "Condominio" e um traco no
-- lugar do nome — o mesmo defeito que a 0115 corrigiu para a expedicao.
DROP POLICY IF EXISTS "condominios_leitura" ON public.condominios;
CREATE POLICY "condominios_leitura" ON public.condominios
  FOR SELECT TO authenticated
  USING (
    public.papel_atual() IN (
      'master', 'departamento',
      'supervisora', 'supervisora_contabilidade', 'supervisor_gerentes',
      'expedicao'
    )
    OR gerente_id IN (SELECT g.id FROM public.gerentes g WHERE g.profile_id = auth.uid())
    OR gerente_id IN (
         SELECT g.id FROM public.gerentes g
          JOIN public.profiles p ON p.gerente_id = g.profile_id
         WHERE p.id = auth.uid()
       )
    OR id IN (SELECT condominio_id FROM public.condominios_por_ausencia())
  );


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- As duas tabelas e a funcao existem (3 linhas):
--   SELECT 'tabela: ' || table_name FROM information_schema.tables
--    WHERE table_schema='public' AND table_name IN ('gerente_ausencias','gerente_ausencia_condominios')
--   UNION ALL
--   SELECT 'funcao: ' || proname FROM pg_proc WHERE proname = 'condominios_por_ausencia';
--
-- As politicas ja enxergam a ausencia (3 linhas, todas 'ok'):
--   SELECT tablename,
--          CASE WHEN qual LIKE '%condominios_por_ausencia%' THEN 'ok' ELSE '>>> FALTA <<<' END AS veredito
--     FROM pg_policies
--    WHERE policyname IN ('pacotes_carteira','arquivos_carteira','condominios_leitura');
--
-- Ausencias valendo hoje (0 agora):
--   SELECT g.nome, a.motivo, a.data_inicio, a.data_fim, count(ac.id) AS condominios
--     FROM gerente_ausencias a
--     JOIN gerentes g ON g.id = a.gerente_id
--     LEFT JOIN gerente_ausencia_condominios ac ON ac.ausencia_id = a.id
--    WHERE a.encerrada_em IS NULL AND current_date BETWEEN a.data_inicio AND a.data_fim
--    GROUP BY 1,2,3,4;


-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- DROP TABLE IF EXISTS public.gerente_ausencia_condominios;
-- DROP TABLE IF EXISTS public.gerente_ausencias;
-- DROP FUNCTION IF EXISTS public.condominios_por_ausencia();
-- ALTER TABLE public.emissoes_pacotes_aprovacoes
--   DROP COLUMN IF EXISTS em_nome_de, DROP COLUMN IF EXISTS motivo;
-- E recriar `pacotes_carteira` / `arquivos_carteira` como estao na 0103 e
-- `condominios_leitura` como esta na 0115.
