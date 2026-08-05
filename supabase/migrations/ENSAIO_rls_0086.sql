-- ============================================================
-- ENSAIO da 0086 (grupos de emissão) — NÃO É MIGRATION
-- ============================================================
-- Aplica a 0086 de mentira, mostra o que ela criaria, e DESFAZ TUDO.
--
-- ⚠️ RESULTADO EM VERMELHO é o formato do relatório, não falha.
--
-- O QUE OLHAR:
--   • "Geral" tem de dar 1 por condomínio (~303)
--   • os grupos de 2º vencimento têm de dar 26
--   • o 366 tem de aparecer com DOIS grupos: dia 7 e dia 10
--   • UNIQUE removido de emissoes_pacotes
-- ============================================================

-- ============================================================
-- 0086 — Grupos de emissão: mais de um vencimento, mais de uma emissão
-- ============================================================
-- O PROBLEMA, visto na planilha do 366 (Cond. Ed. Reno, vence dia 7 E 10):
--
--     CASA ZELADOR VENC 10
--     CONSUMO DE ÁGUA - ZEL
--     CONSUMO DE ENERGIA - 2
--
-- O gerente escreve o vencimento e o agrupamento DENTRO DO NOME da verba, porque
-- o sistema não tem onde guardar isso. E o banco reforça: `emissoes_pacotes` tem
--
--     UNIQUE(condominio_id, mes_referencia, ano_referencia)
--
-- ou seja, UMA emissão por condomínio por mês. Dois vencimentos, dois blocos ou
-- uma retificação avulsa são impossíveis por construção, não por falta de tela.
--
-- 26 dos 303 condomínios têm segundo vencimento (0054). O 366 é (7, 10).
--
-- ── O QUE ESTA MIGRATION FAZ ──
--   1. `condominio_grupos` — grupos nomeados, cada um com seu vencimento
--   2. backfill: um grupo "Geral" por condomínio, com o due_day atual; e um
--      segundo grupo para os 26 que têm due_day_2
--   3. `rateios_config.grupo_id` — a verba passa a saber a que grupo pertence
--   4. `emissoes_pacotes.grupo_id` + DERRUBA o UNIQUE que impedia tudo
--
-- ── DECISÕES DO USUÁRIO (não invente diferente depois) ──
--   • Emissão é LIVRE: sem UNIQUE. Quantas quiser no mesmo mês, o grupo é
--     rótulo, não regra. Emissão sem grupo continua válida — os 277 condomínios
--     de vencimento único não sentem nada.
--   • O CONJUNTO é a unidade de aprovação. Nada é registrado enquanto todas as
--     emissões do condomínio+mês não estiverem aprovadas: os boletos saem juntos,
--     e mandar parte deles é pior que atrasar. Uma recusa devolve o conjunto.
--   • A PLANILHA continua uma só por condomínio+mês. Os grupos são seções dentro
--     dela — é a mesma previsão, da mesma pessoa, na mesma tela.
--
-- ⚠️ ROLLBACK:
--   ALTER TABLE public.emissoes_pacotes DROP COLUMN IF EXISTS grupo_id;
--   ALTER TABLE public.rateios_config   DROP COLUMN IF EXISTS grupo_id;
--   DROP TABLE IF EXISTS public.condominio_grupos;
--   ALTER TABLE public.emissoes_pacotes
--     ADD CONSTRAINT emissoes_pacotes_condominio_id_mes_referencia_ano_referencia_key
--     UNIQUE (condominio_id, mes_referencia, ano_referencia);
--   -- (o UNIQUE só volta se não houver duplicata criada nesse meio-tempo)
-- ============================================================

-- ══ 1. A tabela de grupos ══
CREATE TABLE IF NOT EXISTS public.condominio_grupos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  nome          text NOT NULL,
  due_day       integer CHECK (due_day BETWEEN 1 AND 31),
  ordem         integer NOT NULL DEFAULT 0,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (condominio_id, nome)
);

CREATE INDEX IF NOT EXISTS idx_grupos_condominio ON public.condominio_grupos(condominio_id, ordem);

-- ══ 2. Backfill ══
-- Todo condomínio ganha "Geral" com o vencimento que já tem. Sem isso, um
-- condomínio sem grupo nenhum viraria caso especial em toda consulta.
INSERT INTO public.condominio_grupos (condominio_id, nome, due_day, ordem)
SELECT c.id, 'Geral', c.due_day, 0
  FROM public.condominios c
ON CONFLICT (condominio_id, nome) DO NOTHING;

-- Os 26 com segundo vencimento ganham um grupo para ele. O nome sai genérico de
-- propósito ("Vencimento dia N") — quem conhece o condomínio renomeia depois
-- para "Zelador", "Bloco B" ou o que for. Chutar o nome seria pior que deixar
-- explícito o que se sabe: que existe um segundo vencimento.
INSERT INTO public.condominio_grupos (condominio_id, nome, due_day, ordem)
SELECT c.id, 'Vencimento dia ' || c.due_day_2, c.due_day_2, 1
  FROM public.condominios c
 WHERE c.due_day_2 IS NOT NULL
ON CONFLICT (condominio_id, nome) DO NOTHING;

-- ══ 3. A verba sabe a que grupo pertence ══
-- NULL = grupo "Geral". Nullable de propósito: nenhuma verba existente precisa
-- ser tocada, e o front trata NULL como Geral.
ALTER TABLE public.rateios_config
  ADD COLUMN IF NOT EXISTS grupo_id uuid REFERENCES public.condominio_grupos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rateios_config_grupo ON public.rateios_config(grupo_id);

-- ══ 4. A emissão sabe a que grupo pertence — e deixa de ser única ══
ALTER TABLE public.emissoes_pacotes
  ADD COLUMN IF NOT EXISTS grupo_id uuid REFERENCES public.condominio_grupos(id) ON DELETE SET NULL;

-- O constraint que impedia tudo. O nome é o gerado automaticamente pelo Postgres
-- em 0006; o DO abaixo o encontra pelo formato, para não depender do nome exato.
DO $derruba$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.emissoes_pacotes'::regclass
       AND contype  = 'u'
  LOOP
    EXECUTE format('ALTER TABLE public.emissoes_pacotes DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'UNIQUE removido: %', r.conname;
  END LOOP;
END $derruba$;

-- Índice no lugar do UNIQUE: as consultas por condomínio+mês continuam rápidas,
-- mas agora podem devolver mais de uma linha — que é o ponto.
CREATE INDEX IF NOT EXISTS idx_pacotes_condo_mes
  ON public.emissoes_pacotes(condominio_id, ano_referencia, mes_referencia);

-- ── Conferência ──
-- Grupos criados (deve dar 303 "Geral" + 26 do segundo vencimento):
--   SELECT nome, count(*) FROM public.condominio_grupos GROUP BY nome ORDER BY 2 DESC LIMIT 5;
--
-- O condomínio do print (366) deve ter dois, com 7 e 10:
--   SELECT g.nome, g.due_day FROM public.condominio_grupos g
--     JOIN public.condominios c ON c.id = g.condominio_id
--    WHERE c.name LIKE '366%' ORDER BY g.ordem;
--
-- O UNIQUE não existe mais (0 linhas):
--   SELECT conname FROM pg_constraint
--    WHERE conrelid='public.emissoes_pacotes'::regclass AND contype='u';

DO $ensaio$
DECLARE
  n_condo bigint; n_geral bigint; n_segundo bigint; n_unique bigint;
  linhas text := ''; r RECORD;
BEGIN
  SELECT count(*) INTO n_condo  FROM public.condominios;
  SELECT count(*) INTO n_geral  FROM public.condominio_grupos WHERE nome='Geral';
  SELECT count(*) INTO n_segundo FROM public.condominio_grupos WHERE nome LIKE 'Vencimento dia %';
  SELECT count(*) INTO n_unique FROM pg_constraint
   WHERE conrelid='public.emissoes_pacotes'::regclass AND contype='u';

  linhas := format(E'Condominios no banco ........ %s\n', n_condo)
         || format(E'Grupos "Geral" criados ...... %s   %s\n', n_geral,
                   CASE WHEN n_geral = n_condo THEN '(OK - um por condominio)'
                        ELSE '(ATENCAO - deveria igualar o total)' END)
         || format(E'Grupos de 2o vencimento ..... %s   %s\n', n_segundo,
                   CASE WHEN n_segundo = 26 THEN '(OK - os 26 da 0054)'
                        ELSE '(confira: a 0054 listava 26)' END)
         || format(E'UNIQUE em emissoes_pacotes .. %s   %s\n', n_unique,
                   CASE WHEN n_unique = 0 THEN '(OK - removido, varias emissoes liberadas)'
                        ELSE '(PERIGO - ainda impede mais de uma emissao)' END)
         || E'\n  Condominios com DOIS grupos (amostra):\n';

  FOR r IN
    SELECT c.name, string_agg(g.nome || ' = dia ' || coalesce(g.due_day::text,'?'), '  |  '
                              ORDER BY g.ordem) AS grupos
      FROM public.condominio_grupos g
      JOIN public.condominios c ON c.id = g.condominio_id
     GROUP BY c.id, c.name HAVING count(*) > 1
     ORDER BY c.name LIMIT 6
  LOOP
    linhas := linhas || format(E'    %-34s %s\n', left(r.name,34), r.grupos);
  END LOOP;

  RAISE EXCEPTION E'\n=== VEREDITO 0086 (nada foi gravado) ===\n%', linhas;
END
$ensaio$;
