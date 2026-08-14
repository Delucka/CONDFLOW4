-- Mesma conferência do CONFERIR_0052_0079.sql, mas devolvendo SÓ o que NÃO está
-- no banco. Se vier vazio, as 29 estão aplicadas e o applied.txt pode ser
-- reescrito com essa certeza. Continua sem escrever nada.

WITH col AS (
  SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'
),
tab AS (SELECT table_name FROM information_schema.tables WHERE table_schema='public'),
idx AS (SELECT indexname FROM pg_indexes WHERE schemaname='public'),
fun AS (
  SELECT p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
),
trg AS (SELECT tgname FROM pg_trigger WHERE NOT tgisinternal),
pol AS (SELECT schemaname, tablename, policyname, cmd FROM pg_policies),
checagens(ordem, migration, o_que_confere, presente) AS (
  VALUES
  (52,'0052_pacote_auditoria_aprovacao','coluna emissoes_pacotes.aprovado_por_nome',
      (SELECT count(*)>0 FROM col WHERE table_name='emissoes_pacotes' AND column_name='aprovado_por_nome')),
  (53,'0053_pacote_aprovacoes_chain','tabela emissoes_pacotes_aprovacoes',
      (SELECT count(*)>0 FROM tab WHERE table_name='emissoes_pacotes_aprovacoes')),
  (54,'0054_vencimentos_reais','coluna condominios.due_day_2',
      (SELECT count(*)>0 FROM col WHERE table_name='condominios' AND column_name='due_day_2')),
  (55,'0055_consumos_multiplas_contas','indice uq_consumos_condo_periodo_conc_hash',
      (SELECT count(*)>0 FROM idx WHERE indexname='uq_consumos_condo_periodo_conc_hash')),
  (56,'0056_condominios_caracteristicas','coluna condominios.caracteristicas',
      (SELECT count(*)>0 FROM col WHERE table_name='condominios' AND column_name='caracteristicas')),
  (57,'0057_assistente_gerente','coluna profiles.gerente_id',
      (SELECT count(*)>0 FROM col WHERE table_name='profiles' AND column_name='gerente_id')),
  (58,'0058_fix_sync_concessionaria_on_conflict','sync_concessionaria_to_consumos com arquivo_hash',
      (SELECT count(*)>0 FROM fun WHERE proname='sync_concessionaria_to_consumos' AND def ILIKE '%arquivo_hash%')),
  (60,'0060_retencao_notificacoes','funcao limpar_notificacoes_antigas',
      (SELECT count(*)>0 FROM fun WHERE proname='limpar_notificacoes_antigas')),
  (61,'0061_auto_registro_solicitacao_correcao','trigger trg_registrar_solicitacao_correcao',
      (SELECT count(*)>0 FROM trg WHERE tgname='trg_registrar_solicitacao_correcao')),
  (62,'0062_ocorrencias_reabertura_e_autoresolve','coluna emissoes_ocorrencias.origem',
      (SELECT count(*)>0 FROM col WHERE table_name='emissoes_ocorrencias' AND column_name='origem')),
  (63,'0063_audit_erros','tabela audit_erros',
      (SELECT count(*)>0 FROM tab WHERE table_name='audit_erros')),
  (64,'0064_hardening_bucket_emissoes','bucket emissoes privado e com limite',
      (SELECT count(*)>0 FROM storage.buckets WHERE id='emissoes' AND public=false AND file_size_limit IS NOT NULL)),
  (65,'0065_segundas_vias','tabela segundas_vias',
      (SELECT count(*)>0 FROM tab WHERE table_name='segundas_vias')),
  (67,'0067_segundas_vias_bloco','coluna segundas_vias.bloco',
      (SELECT count(*)>0 FROM col WHERE table_name='segundas_vias' AND column_name='bloco')),
  (68,'0068_storage_rls_lockdown','nenhuma policy de SELECT em storage.objects',
      (SELECT count(*)=0 FROM pol WHERE schemaname='storage' AND tablename='objects' AND cmd IN ('SELECT','ALL'))),
  (69,'0069_segundas_vias_integracao','coluna segundas_vias.ahreas_ref',
      (SELECT count(*)>0 FROM col WHERE table_name='segundas_vias' AND column_name='ahreas_ref')),
  (70,'0070_wa_conversas','tabela wa_conversas',
      (SELECT count(*)>0 FROM tab WHERE table_name='wa_conversas')),
  (71,'0071_condominos','tabela condominos',
      (SELECT count(*)>0 FROM tab WHERE table_name='condominos')),
  (73,'0073_rls_rateios','policy rateios_config_master',
      (SELECT count(*)>0 FROM pol WHERE tablename='rateios_config' AND policyname='rateios_config_master')),
  (74,'0074_segundas_vias_historico','tabela segundas_vias_historico',
      (SELECT count(*)>0 FROM tab WHERE table_name='segundas_vias_historico')),
  (75,'0075_indices_abrir_arquivo','indice idx_emissoes_arquivos_url',
      (SELECT count(*)>0 FROM idx WHERE indexname='idx_emissoes_arquivos_url')),
  (76,'0076_cobrancas_snapshot','coluna emissoes_pacotes.cobrancas_snapshot',
      (SELECT count(*)>0 FROM col WHERE table_name='emissoes_pacotes' AND column_name='cobrancas_snapshot')),
  (77,'0077_fix_notificacao_supervisor_por_role','notificar_emissao com ramo supervisor_gerentes',
      (SELECT count(*)>0 FROM fun WHERE proname='notificar_emissao' AND def ILIKE '%supervisor_gerentes%')),
  (78,'0078_resolver_reabertura_ao_liberar','trigger trg_resolver_reabertura_ao_liberar',
      (SELECT count(*)>0 FROM trg WHERE tgname='trg_resolver_reabertura_ao_liberar')),
  -- As 4 de e-mail reescrevem a MESMA funcao: conferidas em bloco, uma linha so.
  (79,'0059/0066/0072/0079 (email_template)','qual versao do template esta viva',
      (SELECT count(*)>0 FROM fun WHERE proname='email_template'))
)
SELECT migration, o_que_confere
  FROM checagens
 WHERE NOT presente
 ORDER BY ordem;
