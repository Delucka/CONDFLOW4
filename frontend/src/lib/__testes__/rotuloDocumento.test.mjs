// Confere o rótulo contra os dados reais da base (25 relatórios, 54 faturas).
import { nomeDocumento } from '../rotuloDocumento.js';

const casos = [
  // relatórios reais
  { categoria: 'relatorio_leitura', relatorio_tipo_servico: 'agua', subtipo: 'Prosper', relatorio_empresa: 'PROSPER', esperado: '4 · Água' },
  { categoria: 'relatorio_leitura', relatorio_tipo_servico: 'gas',  subtipo: 'Prosper', relatorio_empresa: 'PROSPER', esperado: '5 · Gás' },
  { categoria: 'relatorio_leitura', relatorio_tipo_servico: 'agua', subtipo: 'SABESP', esperado: '4 · Água' },
  { categoria: 'relatorio_leitura', relatorio_tipo_servico: 'gas',  subtipo: 'COMGAS', esperado: '5 · Gás' },
  { categoria: 'relatorio_leitura', relatorio_tipo_servico: 'agua', subtipo: 'PROVISERV', esperado: '4 · Água' },
  { categoria: 'relatorio_leitura', relatorio_tipo_servico: 'agua', subtipo: 'metragen', esperado: '4 · Água' },
  // sem o campo: cai na empresa, depois no nome
  { categoria: 'relatorio_leitura', subtipo: 'COMGAS', esperado: '5 · Gás' },
  { categoria: 'relatorio_leitura', subtipo: 'SABESP', esperado: '4 · Água' },
  { categoria: 'relatorio_leitura', subtipo: 'Prosper', arquivo_nome: '0411 - PROSPER - gas - R$ 5.925,08.pdf', esperado: '5 · Gás' },
  { categoria: 'relatorio_leitura', subtipo: 'Prosper', arquivo_nome: 'RelControleConsumos (80).pdf', esperado: 'não identificado' },
  // faturas reais
  { categoria: 'concessionaria', subtipo: 'SABESP', esperado: '4 · Água' },
  { categoria: 'concessionaria', subtipo: 'COMGAS', esperado: '5 · Gás' },
  { categoria: 'concessionaria', subtipo: 'ENEL',   esperado: '6 · Energia' },
  // vagas de upload
  { categoria: 'emissao', esperado: '1 · Emissão' },
  { categoria: 'outros', subtipo: 'Correios', esperado: '2 · Correios' },
  { categoria: 'outros', subtipo: 'Seguro', esperado: '3 · Seguro' },
  { categoria: 'outros', subtipo: 'Salão de festas', esperado: '7 · Salão' },
  { categoria: 'outros', subtipo: 'Relatório de Rateio', esperado: '8 · Relatório de rateio' },
];

let falhas = 0;
for (const c of casos) {
  const nome = nomeDocumento(c);
  const ok = nome.startsWith(c.esperado) || nome.includes(c.esperado);
  if (!ok) falhas++;
  console.log(`${ok ? 'ok  ' : 'ERRO'} ${nome}`);
}
console.log(falhas === 0 ? '\ntodos os casos passaram' : `\n${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
