-- ============================================================================
-- CONFERÊNCIA: as migrations 0052–0079 estão no banco?
--
-- POR QUE ISTO EXISTE
--
-- O applied.txt ficou parado no 0051 por meses enquanto o banco seguia. Já
-- custou horas: o código citava colunas que a gente supunha existirem "porque a
-- migration está no repositório", e o cadastro quebrava com PGRST204 sem
-- ninguém entender.
--
-- Este script NÃO ESCREVE NADA. Só lê catálogo (information_schema, pg_proc,
-- pg_indexes, pg_policies, storage.buckets) e devolve uma linha por migration
-- dizendo SIM ou NAO.
--
-- COMO LER O RESULTADO
--
--   SIM  — o que a migration cria está no banco.
--   NAO  — não está. Se o código depende disso, é bug esperando acontecer.
--
-- As quatro migrations de e-mail (0059, 0066, 0072, 0079) reescrevem a MESMA
-- função `email_template`. Só a última aplicada é visível — por isso elas são
-- conferidas pelo conteúdo, e no máximo uma delas dá SIM. As outras três
-- aparecem como "substituída", que não é o mesmo que "não aplicada".
--
-- Rode inteiro e me mande o resultado.
-- ============================================================================

WITH col AS (
  SELECT table_name, column_name
    FROM information_schema.columns
   WHERE table_schema = 'public'
),
tab AS (
  SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
),
idx AS (
  SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
),
fun AS (
  SELECT p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
),
trg AS (
  SELECT tgname FROM pg_trigger WHERE NOT tgisinternal
),
pol AS (
  SELECT schemaname, tablename, policyname, cmd FROM pg_policies
),
checagens(ordem, migration, o_que_confere, presente) AS (
  VALUES
  (52, '0052_pacote_auditoria_aprovacao',
       'coluna emissoes_pacotes.aprovado_por_nome',
       (SELECT count(*) > 0 FROM col WHERE table_name='emissoes_pacotes' AND column_name='aprovado_por_nome')),

  (53, '0053_pacote_aprovacoes_chain',
       'tabela emissoes_pacotes_aprovacoes',
       (SELECT count(*) > 0 FROM tab WHERE table_name='emissoes_pacotes_aprovacoes')),

  (54, '0054_vencimentos_reais',
       'coluna condominios.due_day_2',
       (SELECT count(*) > 0 FROM col WHERE table_name='condominios' AND column_name='due_day_2')),

  (55, '0055_consumos_multiplas_contas',
       'índice uq_consumos_condo_periodo_conc_hash',
       (SELECT count(*) > 0 FROM idx WHERE indexname='uq_consumos_condo_periodo_conc_hash')),

  (56, '0056_condominios_caracteristicas',
       'coluna condominios.caracteristicas',
       (SELECT count(*) > 0 FROM col WHERE table_name='condominios' AND column_name='caracteristicas')),

  (57, '0057_assistente_gerente',
       'coluna profiles.gerente_id',
       (SELECT count(*) > 0 FROM col WHERE table_name='profiles' AND column_name='gerente_id')),

  (58, '0058_fix_sync_concessionaria_on_conflict',
       'sync_concessionaria_to_consumos com arquivo_hash no ON CONFLICT',
       (SELECT count(*) > 0 FROM fun WHERE proname='sync_concessionaria_to_consumos' AND def ILIKE '%arquivo_hash%')),

  (59, '0059_email_template_pinguim',
       'email_template com o GIF do pinguim (versão anterior à 0072)',
       (SELECT count(*) > 0 FROM fun WHERE proname='email_template'
          AND def ILIKE '%email-penguin.gif%' AND def NOT ILIKE '%emissaonline.com%')),

  (60, '0060_retencao_notificacoes',
       'função limpar_notificacoes_antigas',
       (SELECT count(*) > 0 FROM fun WHERE proname='limpar_notificacoes_antigas')),

  (61, '0061_auto_registro_solicitacao_correcao',
       'trigger trg_registrar_solicitacao_correcao',
       (SELECT count(*) > 0 FROM trg WHERE tgname='trg_registrar_solicitacao_correcao')),

  (62, '0062_ocorrencias_reabertura_e_autoresolve',
       'coluna emissoes_ocorrencias.origem',
       (SELECT count(*) > 0 FROM col WHERE table_name='emissoes_ocorrencias' AND column_name='origem')),

  (63, '0063_audit_erros',
       'tabela audit_erros',
       (SELECT count(*) > 0 FROM tab WHERE table_name='audit_erros')),

  (64, '0064_hardening_bucket_emissoes',
       'bucket emissoes privado e com limite de tamanho',
       (SELECT count(*) > 0 FROM storage.buckets
         WHERE id='emissoes' AND public = false AND file_size_limit IS NOT NULL)),

  (65, '0065_segundas_vias',
       'tabela segundas_vias',
       (SELECT count(*) > 0 FROM tab WHERE table_name='segundas_vias')),

  (66, '0066_email_template_corporativo',
       'email_template na versão corporativa (anterior à 0072)',
       (SELECT count(*) > 0 FROM fun WHERE proname='email_template'
          AND def NOT ILIKE '%emissaonline.com%' AND def NOT ILIKE '%email-penguin.gif%')),

  (67, '0067_segundas_vias_bloco',
       'coluna segundas_vias.bloco',
       (SELECT count(*) > 0 FROM col WHERE table_name='segundas_vias' AND column_name='bloco')),

  (68, '0068_storage_rls_lockdown',
       'nenhuma policy de SELECT em storage.objects',
       (SELECT count(*) = 0 FROM pol
         WHERE schemaname='storage' AND tablename='objects' AND cmd IN ('SELECT','ALL'))),

  (69, '0069_segundas_vias_integracao',
       'coluna segundas_vias.ahreas_ref',
       (SELECT count(*) > 0 FROM col WHERE table_name='segundas_vias' AND column_name='ahreas_ref')),

  (70, '0070_wa_conversas',
       'tabela wa_conversas',
       (SELECT count(*) > 0 FROM tab WHERE table_name='wa_conversas')),

  (71, '0071_condominos',
       'tabela condominos',
       (SELECT count(*) > 0 FROM tab WHERE table_name='condominos')),

  (72, '0072_email_template_emissaonline',
       'email_template apontando para emissaonline.com com o pinguim',
       (SELECT count(*) > 0 FROM fun WHERE proname='email_template'
          AND def ILIKE '%emissaonline.com/email-penguin.gif%')),

  (73, '0073_rls_rateios',
       'policy rateios_config_master',
       (SELECT count(*) > 0 FROM pol WHERE tablename='rateios_config' AND policyname='rateios_config_master')),

  (74, '0074_segundas_vias_historico',
       'tabela segundas_vias_historico',
       (SELECT count(*) > 0 FROM tab WHERE table_name='segundas_vias_historico')),

  (75, '0075_indices_abrir_arquivo',
       'índice idx_emissoes_arquivos_url',
       (SELECT count(*) > 0 FROM idx WHERE indexname='idx_emissoes_arquivos_url')),

  (76, '0076_cobrancas_snapshot',
       'coluna emissoes_pacotes.cobrancas_snapshot',
       (SELECT count(*) > 0 FROM col WHERE table_name='emissoes_pacotes' AND column_name='cobrancas_snapshot')),

  (77, '0077_fix_notificacao_supervisor_por_role',
       'notificar_emissao com o ramo por role do supervisor de gerentes',
       (SELECT count(*) > 0 FROM fun WHERE proname='notificar_emissao'
          AND def ILIKE '%supervisor_gerentes%')),

  (78, '0078_resolver_reabertura_ao_liberar',
       'trigger trg_resolver_reabertura_ao_liberar',
       (SELECT count(*) > 0 FROM trg WHERE tgname='trg_resolver_reabertura_ao_liberar')),

  (79, '0079_email_template_logo_vizinhanca',
       'email_template com o logo novo (email-logo.png)',
       (SELECT count(*) > 0 FROM fun WHERE proname='email_template'
          AND def ILIKE '%email-logo.png%'))
)
SELECT
  migration,
  o_que_confere,
  CASE
    WHEN presente THEN 'SIM'
    -- As quatro de e-mail se sobrescrevem: NAO aqui costuma significar
    -- "substituída por uma mais nova", não "nunca rodou".
    WHEN ordem IN (59, 66, 72, 79) THEN 'substituída ou não aplicada'
    ELSE 'NAO'
  END AS situacao
FROM checagens
ORDER BY ordem;
