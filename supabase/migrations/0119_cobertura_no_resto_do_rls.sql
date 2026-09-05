-- ============================================================================
-- 0119 — A cobertura alcança as quatro tabelas que sobraram
-- ============================================================================
--
-- COMO CHEGUEI AQUI. A consulta de conferência da 0118 listou toda política que
-- ainda resolve carteira sozinha, sem saber de ausência. Voltaram sete. Três já
-- estavam cobertas por outra política da mesma tabela (as permissivas se somam
-- com OR, então uma antiga que não concede também não bloqueia):
--
--   emissoes_arquivos  "Emissoes - Gerente ve e altera sua carteira"  → `arquivos_carteira` (0117) concede
--   cobrancas_extras   as duas politicas antigas                      → `cobrancas_extras_*` (0081) concede,
--                                                                        porque a 0118 ensinou
--                                                                        `condominios_da_carteira()`
--
-- Sobraram QUATRO tabelas onde a política que resolve carteira é a única que
-- existe — e nelas o substituto simplesmente não passa.
--
-- POR QUE POLÍTICA NOVA, E NÃO REESCREVER AS ANTIGAS. Acrescentar é seguro:
-- política permissiva só CONCEDE, nunca revoga. Reescrever exigiria eu reproduzir
-- de cabeça condições que não escrevi — a de `cobrancas_extras`, por exemplo,
-- restringe a edição ao mês "Em Edição". Errar essa cópia daria ao substituto
-- mais poder do que o dono da carteira tem.
--
-- LEITURA ONDE HOJE É LEITURA. `edicoes_mensais` e `condominio_grupos` só dão
-- SELECT ao gerente (quem escreve é a API, com service role). A cobertura segue
-- essa mesma linha: não é hora de ampliar poder, é hora de igualar.
--
-- Tudo aqui é limitado por `condominios_por_ausencia()`, que filtra por
-- `current_date BETWEEN` — no dia seguinte ao fim, fecha sozinho.
--
-- ROLLBACK: `DROP POLICY` nas quatro (nomes no fim do arquivo).
-- ============================================================================

-- ── Ocorrências: o substituto abre e responde as do que está cobrindo ───────
DROP POLICY IF EXISTS ocorrencias_cobertura ON public.emissoes_ocorrencias;
CREATE POLICY ocorrencias_cobertura ON public.emissoes_ocorrencias
  FOR ALL TO authenticated
  USING      (condominio_id IN (SELECT condominio_id FROM public.condominios_por_ausencia()))
  WITH CHECK (condominio_id IN (SELECT condominio_id FROM public.condominios_por_ausencia()));

-- ── Alterações de rateio: faz parte de mexer na planilha ────────────────────
DROP POLICY IF EXISTS alteracoes_rateio_cobertura ON public.alteracoes_rateio;
CREATE POLICY alteracoes_rateio_cobertura ON public.alteracoes_rateio
  FOR ALL TO authenticated
  USING      (condominio_id IN (SELECT condominio_id FROM public.condominios_por_ausencia()))
  WITH CHECK (condominio_id IN (SELECT condominio_id FROM public.condominios_por_ausencia()));

-- ── Edições mensais: leitura, como já é para o gerente ──────────────────────
DROP POLICY IF EXISTS edicoes_cobertura ON public.edicoes_mensais;
CREATE POLICY edicoes_cobertura ON public.edicoes_mensais
  FOR SELECT TO authenticated
  USING (condominio_id IN (SELECT condominio_id FROM public.condominios_por_ausencia()));

-- ── Grupos do condomínio: leitura ───────────────────────────────────────────
DROP POLICY IF EXISTS grupos_cobertura ON public.condominio_grupos;
CREATE POLICY grupos_cobertura ON public.condominio_grupos
  FOR SELECT TO authenticated
  USING (condominio_id IN (SELECT condominio_id FROM public.condominios_por_ausencia()));


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- 1) As quatro politicas novas existem (4 linhas):
--
--   SELECT tablename, policyname FROM pg_policies
--    WHERE policyname IN ('ocorrencias_cobertura','alteracoes_rateio_cobertura',
--                         'edicoes_cobertura','grupos_cobertura')
--    ORDER BY tablename;
--
-- 2) A pergunta que importa: sobrou alguma TABELA onde a carteira e resolvida
--    sozinha e NENHUMA politica sabe de ausencia? Aqui o certo e voltar VAZIO.
--    (Diferente da conferencia da 0118, que listava politicas: uma politica
--    antiga que nao concede e inofensiva se outra da mesma tabela concede.)
--
--   SELECT tablename
--     FROM pg_policies
--    WHERE schemaname = 'public'
--    GROUP BY tablename
--   HAVING bool_or(qual LIKE '%gerentes%profile_id%')          -- resolve carteira
--      AND NOT bool_or(coalesce(qual, '') LIKE '%ausencia%'
--                   OR coalesce(qual, '') LIKE '%condominios_da_carteira%');


-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- DROP POLICY IF EXISTS ocorrencias_cobertura        ON public.emissoes_ocorrencias;
-- DROP POLICY IF EXISTS alteracoes_rateio_cobertura  ON public.alteracoes_rateio;
-- DROP POLICY IF EXISTS edicoes_cobertura            ON public.edicoes_mensais;
-- DROP POLICY IF EXISTS grupos_cobertura             ON public.condominio_grupos;
