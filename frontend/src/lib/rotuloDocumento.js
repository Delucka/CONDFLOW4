/**
 * O nome do documento na tela: o passo da auditoria, não o nome do arquivo.
 *
 * Os arquivos sobem com o nome que o navegador deu — `RelControleConsumos
 * (80).pdf`, `RelCalculoRateio - 2026-08-23T132757.pdf`. Quem confere abre o
 * seletor e lê "3/3 · RelCalculoRateio…", que não diz de que condomínio é, de
 * que mês é, nem em que ponto da conferência aquilo entra.
 *
 * A ordem de auditoria já existe em `lib/extrairEmissao.js` (é ela que monta o
 * PDF único, 1 a 8) — mas vivia só lá dentro, na hora de extrair. Aqui ela vira
 * o rótulo que a pessoa lê enquanto confere.
 *
 * Os passos são os mesmos das vagas de upload do painel:
 *   1 Emissão · 2 Correios · 3 Seguro · 4 Água · 5 Gás · 6 Energia
 *   7 Salão de festas e cobranças · 8 Relatório de rateio
 */

const norm = (t) => String(t || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

export function rotuloDocumento(a) {
  const cat = a?.categoria;
  const sub = norm(a?.subtipo);
  const serv = norm(a?.relatorio_tipo_servico);
  const empresa = a?.subtipo || a?.relatorio_empresa || null;

  if (cat === 'emissao') return { passo: 1, rotulo: 'Emissão a processar' };

  if (cat === 'outros') {
    if (sub.includes('CORREIO')) return { passo: 2, rotulo: 'Correios' };
    if (sub.includes('SEGURO'))  return { passo: 3, rotulo: 'Seguro' };
    if (sub.includes('SALAO'))   return { passo: 7, rotulo: 'Salão de festas' };
    if (sub.includes('RATEIO'))  return { passo: 8, rotulo: 'Relatório de rateio' };
    return { passo: 9, rotulo: a?.subtipo || 'Outro documento' };
  }

  // Gás antes de água: "COMGAS" contém "GAS", e testar água primeiro só
  // funcionaria por acidente.
  if (cat === 'concessionaria') {
    if (/COMGAS|GAS/.test(sub))                       return { passo: 5, rotulo: `Gás — fatura${empresa ? ` ${empresa}` : ''}` };
    if (/ENEL|ENERGIA|ELETROPAULO|CPFL|EDP|LIGHT/.test(sub)) return { passo: 6, rotulo: `Energia — fatura${empresa ? ` ${empresa}` : ''}` };
    if (/SABESP|AGUA|SANEAMENTO/.test(sub))           return { passo: 4, rotulo: `Água — fatura${empresa ? ` ${empresa}` : ''}` };
    return { passo: 6, rotulo: `Concessionária${empresa ? ` ${empresa}` : ''}` };
  }

  if (cat === 'relatorio_leitura') {
    const emp = a?.relatorio_empresa ? ` ${a.relatorio_empresa}` : '';
    // Tres fontes, nesta ordem: o campo que a leitura preencheu, a empresa
    // (SABESP so faz agua, COMGAS so faz gas) e, por ultimo, o nome do arquivo.
    //
    // Nao ha padrao "na duvida e agua": quando nenhuma das tres diz, o rotulo
    // ADMITE que nao sabe. Chutar aqui poria um relatorio de gas no passo da
    // agua com cara de certeza — e o rotulo existe justamente para quem confere
    // poder confiar nele.
    const pistas = `${serv} ${sub} ${norm(a?.arquivo_nome || a?.nome)}`;
    if (/GAS/.test(pistas))                       return { passo: 5, rotulo: `Gás — relatório de leitura${emp}` };
    if (/ENERGIA|ELETRIC|ENEL/.test(pistas))      return { passo: 6, rotulo: `Energia — relatório de leitura${emp}` };
    if (/AGUA|SABESP|HIDROMETR/.test(pistas))     return { passo: 4, rotulo: `Água — relatório de leitura${emp}` };
    return { passo: 9, rotulo: `Relatório de leitura${emp} — serviço não identificado` };
  }

  return { passo: 9, rotulo: 'Outro documento' };
}

/** "4 · Água — fatura SABESP". O que vai no lugar do nome do arquivo. */
export function nomeDocumento(a) {
  const { passo, rotulo } = rotuloDocumento(a);
  return passo <= 8 ? `${passo} · ${rotulo}` : rotulo;
}
