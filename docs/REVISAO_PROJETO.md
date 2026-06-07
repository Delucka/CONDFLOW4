# 🔍 Revisão Geral do Projeto — CondoFlow

> Revisão feita em 07/06/2026. Cobre: qualidade de código, português, e melhorias (com foco em Consumos).

---

## 1. Português / textos visíveis

✅ **Estado bom.** Os textos da interface estão corretos e acentuados (labels, placeholders, toasts, títulos). Não foram encontrados erros graves de português nas telas.

Itens já corrigidos nesta revisão:
- Removidos 2 `console.log` de debug em `admin/importar-gerentes/page.js`.

Pequenos ajustes de consistência sugeridos (opcionais, baixa prioridade):
- Padronizar "concessionária" vs "Concessionária" em títulos (umas telas capitalizam, outras não).
- Em alguns toasts mistura-se "Fatura anexada como final!" e "Fatura enviada!" — alinhar o vocabulário (anexada/enviada/salva) para um termo só.

---

## 2. Como a parte de Consumos funciona hoje (confirmação do fluxo)

O fluxo **emissões → consumos já está implementado e automático**:

```
Emissor anexa PDF na emissão (Central de Emissões)
   ├── Fatura (SABESP/COMGAS/ENEL)  → categoria 'concessionaria'
   │      └─ trigger sync_concessionaria_to_consumos → tabela consumos_faturas
   └── Relatório (Prosper/Outra)     → categoria 'relatorio_leitura'
          └─ trigger sync_relatorio_to_consumos → tabela consumos_relatorios_leitura

Página /consumos lê as DUAS tabelas (polling 30s):
   - Faturas  → matriz mensal por condomínio × concessionária
   - Relatórios → cards/feed de leitura (Prosper etc)
   - Dashboard no topo: stats + banner de alertas (anomalia/duplicata) + feed das últimas anexações
```

**Conclusão:** a informação realmente vem das emissões. O usuário não digita nada — o `pdf_extractor.py` extrai os dados ao anexar (migration 0041 + endpoint `/api/consumos/extrair-pdf`).

---

## 3. Melhorias sugeridas para CONSUMOS (priorizadas)

### 🥇 Alta prioridade

1. **Indicador visual de "veio da emissão X"**
   Hoje a fatura/relatório aparece em /consumos mas não há link de volta pra emissão que a originou. Adicionar um chip "Emissão MM/AAAA" clicável que abre o pacote de origem (`origem_emissao_arquivo_id` já existe na tabela de relatórios).

2. **Coluna/visão de variação de consumo (não só valor)**
   Para relatórios de leitura, o que importa é o **consumo (m³)** além do valor. Mostrar a variação de m³ mês a mês (ex: "Δ +18% no consumo"), pois é o indicador real de vazamento/erro de leitura.

3. **Status de extração visível**
   A migration 0041 criou `extracao_status` (sucesso/parcial/falha). Mostrar um badge na fatura quando a extração foi `parcial`/`falha` para o operador conferir manualmente.

### 🥈 Média prioridade

4. **Exportar consumos (CSV/Excel)** do ano por condomínio — útil para prestação de contas.
5. **Filtro por período (trimestre/semestre)** além do ano inteiro.
6. **Totais por condomínio** no rodapé da matriz (soma anual de água/gás/energia).

### 🥉 Baixa prioridade

7. Gráfico de linha do consumo mensal por condomínio (visual rápido de tendência).
8. Alerta proativo: "Condomínio X não tem fatura SABESP de Junho" (lacuna no mês corrente).

---

## 4. Melhorias gerais do projeto (fora consumos)

### Código
- **2 componentes `StatusBadge`** (`components/` e `central-emissoes/components/`) com lógicas parecidas. Consolidar em um só reduz manutenção (baixo risco agora que ambos usam a mesma paleta).
- **Páginas possivelmente redundantes**: `condominio/[id]/cobrancas` vs `/carteiras/cobrancas`, e `condominio/[id]/emissoes` vs Central de Emissões. Confirmar com o time se ainda são usadas; se não, remover.
- **Tratamento de erro silencioso**: vários `catch {}` vazios no frontend engolem erros. Padronizar para ao menos um `addToast` de erro.

### UX
- **Estados vazios**: garantir que toda lista tenha um empty-state com call-to-action (a maioria já tem).
- **Confirmações destrutivas**: excluir fatura usa `confirm()` nativo. Trocar por modal consistente com o resto do app.

### Performance
- Os endpoints `/api/dashboard` e `/api/consumos/condominios-com-faturas` fazem várias queries. Já há índices (migration 0032). Reavaliar se o polling de 30s em /consumos pode ser SWR com `revalidateOnFocus` apenas (economiza requests).

---

## 5. Itens pendentes herdados (de outros planos)
- `docs/PLANO_CONSUMOS_AUTO_EXTRACAO.md`: extração automática (✅ implementada, falta validar Hidrogeotec — removido, cliente não usa).
- `docs/PLANO_TEMA_CLARO.md`: tema claro (✅ concluído nesta sessão — paleta de 5 cores).

---

## 6. Próximos passos recomendados (ordem)
1. Consumos #1 (link de volta pra emissão) + #2 (variação de consumo m³) — maior valor pro usuário.
2. Consolidar os 2 StatusBadge.
3. Confirmar/remover páginas redundantes.
4. Exportação CSV de consumos.
