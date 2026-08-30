-- ============================================================================
-- RODAR PENDENTES — 0103 · 0110 · 0111
-- ============================================================================
--
-- Cole tudo de uma vez no SQL Editor do Supabase e rode. Na ordem em que está.
--
-- Já conferido no banco (30/08/2026): a 0107 e a 0109 JÁ ESTÃO aplicadas —
-- `rateios_valores.atualizado_em` e `notificacoes.email_html` existem. Não
-- precisam ser rodadas de novo e não estão aqui.
--
-- As três abaixo são re-executáveis: rodar duas vezes não quebra nada.
--
--   0103  RLS — fecha a escrita aberta em pacotes, arquivos, edições e grupos.
--         É a única que muda PERMISSÃO. Depois dela, gerente só escreve na
--         carteira dele. Reverter: o rodapé da 0103 tem o SQL.
--
--   0110  Filipeta — categoria de arquivo + a marca de quem manda filipeta.
--
--   0111  Entrega ao cliente — as três colunas do fim do trabalho.
--
-- No fim tem um bloco CONFERIR que devolve uma linha por item. Rode ele depois
-- e olhe a coluna `veredito`.
-- ============================================================================


-- ==========================================================================
-- ↓↓↓ 0103_rls_fecha_escrita_aberta.sql — RLS — fecha a escrita aberta
-- ==========================================================================

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

DROP POLICY IF EXISTS pacotes_privilegiado ON public.emissoes_pacotes;
CREATE POLICY pacotes_privilegiado ON public.emissoes_pacotes
  FOR ALL TO authenticated
  USING      (papel_atual() = ANY (ARRAY['master','departamento','supervisora',
                                         'supervisora_contabilidade','supervisor_gerentes','expedicao']))
  WITH CHECK (papel_atual() = ANY (ARRAY['master','departamento','supervisora',
                                         'supervisora_contabilidade','supervisor_gerentes','expedicao']));

DROP POLICY IF EXISTS pacotes_carteira ON public.emissoes_pacotes;
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

DROP POLICY IF EXISTS arquivos_privilegiado ON public.emissoes_arquivos;
CREATE POLICY arquivos_privilegiado ON public.emissoes_arquivos
  FOR ALL TO authenticated
  USING      (papel_atual() = ANY (ARRAY['master','departamento','supervisora',
                                         'supervisora_contabilidade','supervisor_gerentes','expedicao']))
  WITH CHECK (papel_atual() = ANY (ARRAY['master','departamento','supervisora',
                                         'supervisora_contabilidade','supervisor_gerentes','expedicao']));

DROP POLICY IF EXISTS arquivos_carteira ON public.emissoes_arquivos;
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

DROP POLICY IF EXISTS edicoes_leitura ON public.edicoes_mensais;
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


-- ==========================================================================
-- ↓↓↓ 0110_expedicao_filipeta.sql — Filipeta
-- ==========================================================================

-- ============================================================================
-- 0110 — Filipeta: o segundo papel que sai junto com o boleto
-- ============================================================================
--
-- A expedição não imprime só boleto. Parte dos condomínios manda junto uma
-- FILIPETA — o informativo que vai no mesmo envelope. Hoje ela não existe no
-- sistema: quem expede sobe tudo pela mesma porta e o arquivo entra como
-- 'boleto' (0095), então a expedição recebe dois papéis contados como um só e
-- não tem como saber se a filipeta veio ou ficou para trás.
--
-- Duas coisas, porque são duas perguntas diferentes:
--
--   categoria = 'filipeta'   O QUE este arquivo é.
--   usa_filipeta             SE este condomínio deveria ter uma.
--
-- A segunda é o que transforma o esquecimento em aviso. Sem ela, filipeta que
-- falta é indistinguível de filipeta que nunca existiu — e a expedição só
-- descobre depois de o envelope ter saído.
--
-- Não há gatilho travando nada: a emissão sai sem filipeta se for o caso. A
-- marca serve para a tela avisar, não para impedir.
--
-- ROLLBACK:
--   ALTER TABLE public.condominios DROP COLUMN IF EXISTS usa_filipeta;
--   ALTER TABLE public.emissoes_arquivos DROP CONSTRAINT emissoes_arquivos_categoria_check;
--   ALTER TABLE public.emissoes_arquivos ADD CONSTRAINT emissoes_arquivos_categoria_check
--     CHECK (categoria IN ('emissao','concessionaria','outros','relatorio_leitura','boleto'));
--   (rodar o DROP da coluna só se nenhum arquivo estiver com categoria 'filipeta')
-- ============================================================================

ALTER TABLE public.emissoes_arquivos
  DROP CONSTRAINT IF EXISTS emissoes_arquivos_categoria_check;

ALTER TABLE public.emissoes_arquivos
  ADD CONSTRAINT emissoes_arquivos_categoria_check
  CHECK (categoria IN ('emissao', 'concessionaria', 'outros', 'relatorio_leitura', 'boleto', 'filipeta'));


ALTER TABLE public.condominios
  ADD COLUMN IF NOT EXISTS usa_filipeta boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.condominios.usa_filipeta IS
  'Este condomínio manda filipeta junto com o boleto. A expedição avisa quando ela não veio.';

-- A fila de expedição lê boleto e filipeta do mesmo pacote, na mesma consulta.
CREATE INDEX IF NOT EXISTS idx_emissoes_arquivos_expedicao
  ON public.emissoes_arquivos(pacote_id, categoria)
  WHERE categoria IN ('boleto', 'filipeta');


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- A coluna existe (1 linha):
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='condominios' AND column_name='usa_filipeta';
--
-- O CHECK aceita 'filipeta' (deve rodar sem erro e devolver 0):
--   SELECT count(*) FROM public.emissoes_arquivos WHERE categoria = 'filipeta';
--
-- Quem manda filipeta (0 agora; marcar pela tela de cadastro):
--   SELECT name FROM public.condominios WHERE usa_filipeta ORDER BY name;


-- ==========================================================================
-- ↓↓↓ 0111_entrega_ao_cliente.sql — Entrega ao cliente
-- ==========================================================================

-- ============================================================================
-- 0111 — A entrega ao cliente, que é onde o trabalho realmente termina
-- ============================================================================
--
-- A expedição não é a impressora. Ela imprime o trabalho final E leva ao
-- cliente — e é essa segunda metade que o sistema não registrava.
--
-- Hoje o único marco é `impresso_em` por arquivo (0094). Saiu da impressora e
-- acabou a trilha. Só que entre a impressora e o síndico existe o pedaço que
-- todo mundo cobra: "chegou?", "quando?", "quem recebeu?". A resposta vivia na
-- memória de quem entregou.
--
-- Pior: `prazo_expedicao_dia` (0096) é prazo de ENTREGA. O sistema guardava a
-- data limite de um evento que não sabia registrar — o prazo existia, o
-- cumprimento não.
--
-- Três colunas, no PACOTE e não no arquivo: entrega-se a remessa inteira, não
-- folha por folha.
--
--   entregue_em        NULL -> ainda com a expedição · data -> chegou ao cliente
--   entregue_por_nome  quem da expedição levou
--   recebido_por       quem recebeu do lado do cliente (opcional, texto livre)
--
-- `recebido_por` é texto solto de propósito: quem recebe é o zelador, a
-- secretária, o síndico, às vezes "portaria". Uma tabela de pessoas do
-- condomínio seria um cadastro a mais para manter, e ninguém manteria.
--
-- Desfazer é possível (a tela devolve para "a entregar") — marcar errado é
-- comum e não pode virar dívida permanente.
--
-- ROLLBACK:
--   ALTER TABLE public.emissoes_pacotes
--     DROP COLUMN IF EXISTS entregue_em,
--     DROP COLUMN IF EXISTS entregue_por_nome,
--     DROP COLUMN IF EXISTS recebido_por;
-- ============================================================================

ALTER TABLE public.emissoes_pacotes
  ADD COLUMN IF NOT EXISTS entregue_em       timestamptz,
  ADD COLUMN IF NOT EXISTS entregue_por_nome text,
  ADD COLUMN IF NOT EXISTS recebido_por      text;

COMMENT ON COLUMN public.emissoes_pacotes.entregue_em IS
  'Quando a remessa chegou ao cliente. NULL = ainda com a expedição.';
COMMENT ON COLUMN public.emissoes_pacotes.recebido_por IS
  'Quem recebeu no condomínio — zelador, portaria, síndico. Texto livre.';

-- A fila da expedição pergunta "o que ainda não foi entregue" o tempo todo.
CREATE INDEX IF NOT EXISTS idx_emissoes_pacotes_a_entregar
  ON public.emissoes_pacotes(mes_referencia, ano_referencia)
  WHERE entregue_em IS NULL;


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- As três colunas existem (3 linhas):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='emissoes_pacotes'
--      AND column_name IN ('entregue_em','entregue_por_nome','recebido_por');
--
-- O que já saiu e ainda não consta como entregue (tudo, agora):
--   SELECT c.name, p.mes_referencia, p.ano_referencia
--     FROM emissoes_pacotes p JOIN condominios c ON c.id = p.condominio_id
--    WHERE p.status = 'expedida' AND p.entregue_em IS NULL
--    ORDER BY p.ano_referencia DESC, p.mes_referencia DESC, c.name;




-- ============================================================================
-- CONFERIR — rode este bloco DEPOIS. Tudo tem de vir 'ok'.
-- ============================================================================

SELECT '0110 · categoria filipeta' AS item,
       CASE WHEN pg_get_constraintdef(oid) LIKE '%filipeta%' THEN 'ok' ELSE '>>> FALTA <<<' END AS veredito
  FROM pg_constraint WHERE conname = 'emissoes_arquivos_categoria_check'
UNION ALL
SELECT '0110 · condominios.usa_filipeta',
       CASE WHEN count(*) = 1 THEN 'ok' ELSE '>>> FALTA <<<' END
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'condominios' AND column_name = 'usa_filipeta'
UNION ALL
SELECT '0111 · colunas da entrega (3)',
       CASE WHEN count(*) = 3 THEN 'ok' ELSE '>>> FALTA <<<' END
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'emissoes_pacotes'
   AND column_name IN ('entregue_em', 'entregue_por_nome', 'recebido_por')
UNION ALL
SELECT '0103 · policies novas (5)',
       CASE WHEN count(*) = 5 THEN 'ok' ELSE '>>> FALTA <<<' END
  FROM pg_policies
 WHERE schemaname = 'public'
   AND policyname IN ('pacotes_privilegiado', 'pacotes_carteira',
                      'arquivos_privilegiado', 'arquivos_carteira', 'edicoes_leitura')
UNION ALL
SELECT '0103 · nenhuma policy aberta',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE '>>> AINDA ABERTA <<<' END
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('emissoes_pacotes', 'emissoes_arquivos', 'edicoes_mensais', 'condominio_grupos')
   AND (qual = 'true' OR with_check = 'true')
UNION ALL
SELECT '0109 · e-mail com o template da marca',
       CASE WHEN prosrc LIKE '%email_template%' AND prosrc NOT LIKE '%condominios-gamma%'
            THEN 'ok' ELSE '>>> AINDA NO TEMPLATE ANTIGO <<<' END
  FROM pg_proc WHERE proname = 'email_da_notificacao';


-- ============================================================================
-- DEPOIS DE RODAR
-- ============================================================================
-- 1. Marque quem manda filipeta (Condomínios → editar → "Manda filipeta"):
--      SELECT name FROM condominios WHERE usa_filipeta ORDER BY name;
--
-- 2. Crie o login da expedição (Admin → Usuários, papel Expedição). Hoje não
--    existe ninguém com esse papel, e sem isso o aviso não tem destinatário:
--      SELECT count(*) FROM profiles WHERE role = 'expedicao';
