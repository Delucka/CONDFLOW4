-- ============================================================================
-- 0103 — Fecha a escrita aberta em emissoes_pacotes, emissoes_arquivos,
--        edicoes_mensais e a leitura aberta em condominio_grupos
-- ============================================================================
--
-- O QUE ESTÁ ERRADO HOJE
--
-- Quatro policies passam qualquer sessão autenticada:
--
--   pacotes_all_authenticated            ALL   USING (true) WITH CHECK (true)
--   emissoes_arquivos_all_authenticated  ALL   USING (true) WITH CHECK (true)
--   edicoes_mensais_all_authenticated    ALL   USING (true) WITH CHECK (true)
--   grupos_leitura                       SELECT USING (true)
--
-- Policies são PERMISSIVAS e somam: basta uma dizer "true" para as outras da
-- mesma tabela não valerem nada. Em emissoes_arquivos existem duas policies
-- caprichadas recortando carteira ao lado de uma que abre tudo — as duas
-- primeiras são decoração.
--
-- As três primeiras abrem ESCRITA. Uma sessão autenticada qualquer altera a
-- emissão de outro gerente, apaga arquivo alheio, ou libera o mês de quem não
-- é seu — direto pela anon key, sem passar por tela nenhuma.
--
-- POR QUE ELAS EXISTEM
--
-- Fui eu quem as criou, na 0033. O gerente não conseguia aprovar: a policy
-- anterior tinha USING sem WITH CHECK e o UPDATE falhava calado. Abrir tudo
-- resolveu o sintoma e trocou um bug por um buraco. Esta migration faz o que a
-- 0033 deveria ter feito: declara os dois lados (USING e WITH CHECK) para cada
-- grupo de gente que precisa escrever.
--
-- O DESENHO
--
-- Duas policies por tabela, no mesmo padrão que `rateios_config` já usa e que
-- funciona:
--
--   *_privilegiado — quem trabalha com a base inteira (master, departamento,
--                    supervisoras, expedição). USING e WITH CHECK iguais.
--   *_carteira     — gerente e assistente, limitados aos condomínios da
--                    carteira. O assistente entra pelo vínculo da 0057
--                    (profiles.gerente_id), que a policy de `condominios`
--                    já resolve desse jeito — aqui é a mesma expressão.
--
-- `edicoes_mensais` fica só com leitura: nenhuma tela escreve nela pelo
-- navegador (conferido), quem escreve é a API com service role, que não passa
-- por RLS.
--
-- O QUE NÃO MUDA
--
-- As policies `{public}` "Acesso Total …" continuam onde estão. Elas somam
-- acesso, não tiram, e as novas não dependem delas — não preciso saber a lista
-- exata de cargos que cada uma cobre para que isto esteja correto.
--
-- Também não mexo em `profiles_leitura` e `gerentes_leitura`, que estão
-- abertas para LEITURA. São nome, e-mail e cargo de colega — não é dado de
-- condomínio, e fechá-las mexe em quase toda tela que mostra "quem é o
-- gerente". Fica para depois, com teste próprio.
--
-- REVERSÃO: o bloco comentado no fim volta ao estado de hoje.
-- ============================================================================

BEGIN;

-- ── emissoes_pacotes ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS pacotes_all_authenticated ON public.emissoes_pacotes;

CREATE POLICY pacotes_privilegiado ON public.emissoes_pacotes
  FOR ALL TO authenticated
  USING      (papel_atual() = ANY (ARRAY['master','departamento','supervisora',
                                         'supervisora_contabilidade','supervisor_gerentes','expedicao']))
  WITH CHECK (papel_atual() = ANY (ARRAY['master','departamento','supervisora',
                                         'supervisora_contabilidade','supervisor_gerentes','expedicao']));

CREATE POLICY pacotes_carteira ON public.emissoes_pacotes
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM condominios c
     WHERE c.id = emissoes_pacotes.condominio_id
       AND (c.gerente_id IN (SELECT g.id FROM gerentes g WHERE g.profile_id = auth.uid())
         OR c.gerente_id IN (SELECT g.id FROM gerentes g
                               JOIN profiles p ON p.gerente_id = g.profile_id
                              WHERE p.id = auth.uid()))))
  WITH CHECK (EXISTS (
    SELECT 1 FROM condominios c
     WHERE c.id = emissoes_pacotes.condominio_id
       AND (c.gerente_id IN (SELECT g.id FROM gerentes g WHERE g.profile_id = auth.uid())
         OR c.gerente_id IN (SELECT g.id FROM gerentes g
                               JOIN profiles p ON p.gerente_id = g.profile_id
                              WHERE p.id = auth.uid()))));

-- ── emissoes_arquivos ───────────────────────────────────────────────────────
-- A policy de carteira que já existia aqui esquece o assistente: ele anexa
-- documento de cobrança e mexe em consumo, e passava só porque a aberta o
-- deixava passar. Esta o inclui.
DROP POLICY IF EXISTS emissoes_arquivos_all_authenticated ON public.emissoes_arquivos;

CREATE POLICY arquivos_privilegiado ON public.emissoes_arquivos
  FOR ALL TO authenticated
  USING      (papel_atual() = ANY (ARRAY['master','departamento','supervisora',
                                         'supervisora_contabilidade','supervisor_gerentes','expedicao']))
  WITH CHECK (papel_atual() = ANY (ARRAY['master','departamento','supervisora',
                                         'supervisora_contabilidade','supervisor_gerentes','expedicao']));

CREATE POLICY arquivos_carteira ON public.emissoes_arquivos
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM condominios c
     WHERE c.id = emissoes_arquivos.condominio_id
       AND (c.gerente_id IN (SELECT g.id FROM gerentes g WHERE g.profile_id = auth.uid())
         OR c.gerente_id IN (SELECT g.id FROM gerentes g
                               JOIN profiles p ON p.gerente_id = g.profile_id
                              WHERE p.id = auth.uid()))))
  WITH CHECK (EXISTS (
    SELECT 1 FROM condominios c
     WHERE c.id = emissoes_arquivos.condominio_id
       AND (c.gerente_id IN (SELECT g.id FROM gerentes g WHERE g.profile_id = auth.uid())
         OR c.gerente_id IN (SELECT g.id FROM gerentes g
                               JOIN profiles p ON p.gerente_id = g.profile_id
                              WHERE p.id = auth.uid()))));

-- ── edicoes_mensais ─────────────────────────────────────────────────────────
-- Só leitura: quem escreve é a API (service role), que não passa por RLS.
DROP POLICY IF EXISTS edicoes_mensais_all_authenticated ON public.edicoes_mensais;

CREATE POLICY edicoes_leitura ON public.edicoes_mensais
  FOR SELECT TO authenticated
  USING (
    papel_atual() = ANY (ARRAY['master','departamento','supervisora',
                               'supervisora_contabilidade','supervisor_gerentes','expedicao'])
    OR EXISTS (
      SELECT 1 FROM condominios c
       WHERE c.id = edicoes_mensais.condominio_id
         AND (c.gerente_id IN (SELECT g.id FROM gerentes g WHERE g.profile_id = auth.uid())
           OR c.gerente_id IN (SELECT g.id FROM gerentes g
                                 JOIN profiles p ON p.gerente_id = g.profile_id
                                WHERE p.id = auth.uid()))));

-- ── condominio_grupos ───────────────────────────────────────────────────────
-- A escrita já está certa (master/departamento) e não muda aqui. Era a leitura
-- que estava aberta — e foi a 0098, minha, que a abriu para consertar grupos
-- que não apareciam.
DROP POLICY IF EXISTS grupos_leitura ON public.condominio_grupos;

CREATE POLICY grupos_leitura ON public.condominio_grupos
  FOR SELECT TO authenticated
  USING (
    papel_atual() = ANY (ARRAY['master','departamento','supervisora',
                               'supervisora_contabilidade','supervisor_gerentes','expedicao'])
    OR EXISTS (
      SELECT 1 FROM condominios c
       WHERE c.id = condominio_grupos.condominio_id
         AND (c.gerente_id IN (SELECT g.id FROM gerentes g WHERE g.profile_id = auth.uid())
           OR c.gerente_id IN (SELECT g.id FROM gerentes g
                                 JOIN profiles p ON p.gerente_id = g.profile_id
                                WHERE p.id = auth.uid()))));

COMMIT;


-- ============================================================================
-- CONFERIR (rode depois; nenhuma linha deve vir marcada como ABERTA)
-- ============================================================================
-- SELECT tablename, policyname, cmd,
--        CASE WHEN qual = 'true' OR with_check = 'true' THEN '>>> ABERTA <<<'
--             ELSE 'ok' END AS veredito
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN ('emissoes_pacotes','emissoes_arquivos','edicoes_mensais','condominio_grupos')
--  ORDER BY tablename, policyname;


-- ============================================================================
-- REVERTER (volta exatamente ao estado de antes)
-- ============================================================================
-- BEGIN;
-- DROP POLICY IF EXISTS pacotes_privilegiado  ON public.emissoes_pacotes;
-- DROP POLICY IF EXISTS pacotes_carteira      ON public.emissoes_pacotes;
-- DROP POLICY IF EXISTS arquivos_privilegiado ON public.emissoes_arquivos;
-- DROP POLICY IF EXISTS arquivos_carteira     ON public.emissoes_arquivos;
-- DROP POLICY IF EXISTS edicoes_leitura       ON public.edicoes_mensais;
-- DROP POLICY IF EXISTS grupos_leitura        ON public.condominio_grupos;
--
-- CREATE POLICY pacotes_all_authenticated ON public.emissoes_pacotes
--   FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY emissoes_arquivos_all_authenticated ON public.emissoes_arquivos
--   FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY edicoes_mensais_all_authenticated ON public.edicoes_mensais
--   FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY grupos_leitura ON public.condominio_grupos
--   FOR SELECT TO authenticated USING (true);
-- COMMIT;
