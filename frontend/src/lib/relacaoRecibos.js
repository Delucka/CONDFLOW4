// Relação de Recibos — o recibo de cada unidade, lido dos dois anexos da emissão.
//
// DE ONDE VEM CADA COISA
//
//   Emissões a Processar   "Discriminação das verbas": a coluna RATEIO diz QUAIS
//                          rateios esta emissão cobra e por quanto. Traz também
//                          o cabeçalho e o bloco "Características do condomínio",
//                          que são as observações.
//
//   Cálculo do Rateio      uma seção por rateio, identificada no cabeçalho
//                          ("Rateio: 000449"), com a grade bloco | unidade |
//                          valor, três pares por linha.
//
//   tabela `condominos`    o nome de quem paga. Não está em nenhum dos dois
//                          PDFs — o Cálculo só tem `Bl./Unid.`.
//
// O NÚMERO DO RATEIO É A CHAVE entre os dois. Sem ele somam-se todas as seções
// do arquivo, inclusive rateios cadastrados que não entraram nesta emissão: no
// 0001 - BRITISH GARDEN o Cálculo traz 14 e a emissão cobra 8 — diferença de
// R$ 6,5 mil.
//
// POR QUE NO NAVEGADOR: o mesmo motivo já medido em `importarCondominos.js` —
// pdfplumber no backend levou 3,18s contra 0,47s do pdfjs aqui, e a função do
// Vercel corta em 10s. Medindo este relatório: 8s no servidor para o BRITISH
// GARDEN. Não havia margem.
//
// O QUE ESTE MÓDULO NÃO FAZ: não inventa. Quando o rateado diverge do cobrado, a
// diferença sai em `divergencias` para o relatório mostrar — num documento de
// conferência, esconder a divergência é pior que não ter o documento.

const VALOR = /^-?[\d.]{1,12},\d{2}$/;
const UNIDADE = /^[A-Z0-9]{2,10}$/;

const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const num = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));
const semAcento = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '');

/**
 * Remonta os números que o pdfjs entrega picados.
 *
 * O extrator não devolve palavras — devolve os pedaços de texto como o PDF os
 * desenhou. `1.539,85` chega em dois: `"1.539,"` e `"85"`. Sem juntar, nenhum
 * valor casa com o padrão de moeda e o relatório sai com uma fração do total:
 * no 0001 - BRITISH GARDEN, R$ 1.077,93 no lugar de R$ 193.034,54.
 *
 * A junção é conservadora: só encosta pedaços quando o anterior termina em
 * ponto ou vírgula e o seguinte é só dígito/separador. `"0"` + `"A0011"` não se
 * juntam, e `"Bl./Unid."` + `"Valor"` também não.
 */
export function juntarNumeros(tokens) {
  const saida = [];
  for (let i = 0; i < tokens.length; i += 1) {
    let t = tokens[i];
    while (i + 1 < tokens.length && /[.,]$/.test(t) && /^[\d.,]+$/.test(tokens[i + 1])) {
      t += tokens[i + 1];
      i += 1;
      if (VALOR.test(t)) break;
    }
    saida.push(t);
  }
  return saida;
}

let _pdfjs = null;
async function getPdfjs() {
  if (!_pdfjs) {
    // Mesmo par (build legacy + worker self-hosted) de extrairEmissao.js e
    // importarCondominos.js.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    _pdfjs = pdfjs;
  }
  return _pdfjs;
}

/**
 * As páginas do PDF como LINHAS DE PALAVRAS, na ordem visual.
 *
 * Devolve `[[palavra, palavra, …], …]`. Palavras, e não texto corrido: os dois
 * documentos são tabulares, e concatenar `item.str` embaralha as colunas —
 * "0 000223A0011 PAULO…" com unidade e cliente trocados, como já aconteceu na
 * importação de condôminos.
 *
 * O agrupamento é por Y com tolerância, porque a mesma linha do PDF chega com Y
 * ligeiramente diferente entre os pedaços.
 */
export async function linhasDoPdf(arrayBuffer, aoAvancar) {
  const pdfjs = await getPdfjs();
  const tarefa = pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer.slice(0)),
    isEvalSupported: false,
    standardFontDataUrl: '/pdfjs-standard-fonts/',
  });
  const doc = await tarefa.promise;
  const saida = [];

  try {
    for (let n = 1; n <= doc.numPages; n += 1) {
      aoAvancar?.(n, doc.numPages);
      const page = await doc.getPage(n);
      const conteudo = await page.getTextContent();

      const linhas = new Map();
      let ordem = 0;
      for (const item of conteudo.items) {
        if (!item.str || !item.str.trim()) continue;
        const y = Math.round(item.transform[5]);
        let chave = y;
        for (const k of linhas.keys()) {
          if (Math.abs(k - y) <= 2) { chave = k; break; }
        }
        if (!linhas.has(chave)) linhas.set(chave, []);
        // Um item pode trazer várias palavras; todas herdam o x do item e
        // mantêm a ordem em que vieram.
        for (const palavra of item.str.trim().split(/\s+/)) {
          linhas.get(chave).push({ x: item.transform[4], i: ordem++, t: palavra });
        }
      }

      [...linhas.entries()]
        .sort((a, b) => b[0] - a[0])                   // topo → base
        .forEach(([, itens]) => {
          itens.sort((a, b) => a.x - b.x || a.i - b.i); // esquerda → direita
          saida.push(juntarNumeros(itens.map((o) => o.t)));
        });
      page.cleanup();
    }
  } finally {
    try { await tarefa.destroy(); } catch { /* já liberado */ }
  }
  return saida;
}

/** Discriminação das verbas, cabeçalho e observações do condomínio. */
export function lerEmissao(linhas) {
  const cobrados = {};
  const observacoes = [];
  let total = null;
  let quantidade = null;
  let naTabela = false;
  let nasObservacoes = false;

  for (const linha of linhas) {
    const junto = linha.join(' ');
    const limpo = semAcento(junto);

    if (/aracteristicas do condominio/i.test(limpo)) {
      nasObservacoes = true;
      naTabela = false;
      continue;
    }
    if (nasObservacoes) {
      // O rodapé "Emitido em …" mora dentro do mesmo bloco e não é observação.
      if (junto.trim() && !/^Emitido em/.test(limpo)) observacoes.push(junto.trim());
      continue;
    }

    if (/Discrimina/.test(limpo)) { naTabela = true; continue; }
    if (!naTabela) continue;

    if (/Quantidade geral|Total geral/.test(limpo)) {
      const valores = linha.filter((w) => VALOR.test(w));
      const inteiros = linha.filter((w) => /^\d+$/.test(w));
      if (valores.length) total = num(valores[valores.length - 1]);
      if (inteiros.length) quantidade = Number(inteiros[inteiros.length - 1]);
      naTabela = false;
      continue;
    }

    // Linha da tabela: começa pelo número do rateio.
    if (linha.length && /^\d{3,6}$/.test(linha[0])) {
      const valores = linha.filter((w) => VALOR.test(w));
      if (valores.length) cobrados[linha[0].replace(/^0+/, '')] = num(valores[valores.length - 1]);
    }
  }

  const texto = linhas.map((l) => l.join(' ')).join('\n');
  const pega = (rx) => (texto.match(rx)?.[1] || '').trim();
  return {
    cobrados,
    observacoes,
    total,
    quantidade,
    cabecalho: {
      gerente: pega(/Gerente:[ \t]*([^\n]+)/),
      emissao: pega(/Emiss.o:[^\n]*?(\d{4,})/),
      vencimento: pega(/Vencimento:[^\n]*?(\d{2}\/\d{2}\/\d{4})/),
      conta: pega(/(Conta banc.ria:[^\n]+)/),
    },
  };
}

/** Uma entrada por rateio: `{ rateio, historico, declarado, unidades }`. */
export function lerRateio(linhas) {
  const secoes = [];
  let atual = null;
  let ignorar = false;

  for (const linha of linhas) {
    const junto = linha.join(' ');
    const limpo = semAcento(junto).trim();

    // O bloco "Totalizando verbas por unidade" REPETE a grade acima. Contar os
    // dois somaria tudo em dobro.
    if (limpo.includes('Totalizando verbas por unidade')) { ignorar = true; continue; }

    if (linha.length && linha[0].startsWith('Rateio:')) {
      const numero = linha.slice(1).find((w) => /^\d+$/.test(w))?.replace(/^0+/, '') || null;
      const m = junto.match(/Hist.rico:\s*(.+)/);
      const nome = m ? m[1].split(/\s{2,}|Taxa administrativa|Percentual/)[0].trim() : '?';
      atual = { rateio: numero, historico: nome, declarado: null, unidades: {} };
      secoes.push(atual);
      ignorar = false;
      continue;
    }

    if (atual && atual.declarado === null && junto.includes('Valor total:')) {
      const valores = linha.filter((w) => VALOR.test(w));
      if (valores.length) atual.declarado = num(valores[valores.length - 1]);
    }

    if (ignorar || !atual) continue;

    // Grade: (bloco, unidade, valor), três vezes por linha.
    let i = 0;
    while (i < linha.length - 1) {
      const a = linha[i];
      const b = linha[i + 1];
      if (UNIDADE.test(a) && !VALOR.test(a) && VALOR.test(b)) {
        const anterior = i > 0 ? linha[i - 1] : '';
        const bloco = (anterior && !VALOR.test(anterior) && anterior.length <= 3) ? anterior : '';
        atual.unidades[a] = { valor: num(b), bloco };
        i += 2;
      } else {
        i += 1;
      }
    }
  }

  return secoes.filter((s) => Object.keys(s.unidades).length);
}

/** Cruza os dois documentos e devolve o relatório inteiro. */
export function cruzar({ emissao, secoes, nomes = {}, condominio, mes, ano }) {
  const { cobrados } = emissao;
  const dentro = secoes.filter((s) => cobrados[s.rateio] !== undefined);
  const fora = secoes.filter((s) => cobrados[s.rateio] === undefined);

  const somaSecao = (s) => Object.values(s.unidades).reduce((t, u) => t + u.valor, 0);

  const arrecadacoes = [];
  const divergencias = [];
  for (const s of dentro) {
    const rateado = Math.round(somaSecao(s) * 100) / 100;
    const cobrado = cobrados[s.rateio];
    arrecadacoes.push({
      rateio: s.rateio,
      historico: s.historico,
      rateado,
      cobrado,
      unidades: Object.keys(s.unidades).length,
    });
    if (Math.abs(rateado - cobrado) > 0.02) {
      divergencias.push({
        rateio: s.rateio, historico: s.historico, rateado, cobrado,
        diferenca: Math.round((rateado - cobrado) * 100) / 100,
      });
    }
  }

  const porUnidade = new Map();
  for (const s of dentro) {
    for (const [unidade, dados] of Object.entries(s.unidades)) {
      if (!porUnidade.has(unidade)) {
        porUnidade.set(unidade, { unidade, bloco: dados.bloco, condomino: '', itens: [] });
      }
      porUnidade.get(unidade).itens.push({ historico: s.historico, valor: dados.valor });
    }
  }

  // O BLOCO. A coluna `Bl.` do Cálculo vem `0` em todo condomínio que olhamos —
  // é um espaço reservado no formulário, não o bloco. Quem separa os prédios é
  // a letra do código da unidade: no 0001 - BRITISH GARDEN, A0011 e B0032 são
  // torres diferentes e VG são as vagas. Então a coluna vale quando REALMENTE
  // distingue algo, e a letra vale quando ela não distingue.
  const daColuna = new Set([...porUnidade.values()].map((r) => r.bloco).filter(Boolean));
  const usaColuna = daColuna.size > 1;
  const bloco = (r) => (usaColuna ? r.bloco : (r.unidade.match(/^[A-Za-z]+/)?.[0] || ''));

  const achar = (u) => nomes[u.toUpperCase()] || nomes[u.toUpperCase().replace(/^0+/, '')] || '';
  const recibos = [...porUnidade.values()]
    .sort((a, b) => a.unidade.localeCompare(b.unidade, 'pt-BR', { numeric: true }))
    .map((r) => {
      r.bloco = bloco(r);
      r.condomino = achar(r.unidade);
      r.itens.sort((x, y) => y.valor - x.valor);
      r.total = Math.round(r.itens.reduce((t, i) => t + i.valor, 0) * 100) / 100;
      return r;
    });

  const total = Math.round(recibos.reduce((t, r) => t + r.total, 0) * 100) / 100;
  const comNome = recibos.filter((r) => r.condomino).length;
  const blocos = [...new Set(recibos.map((r) => r.bloco).filter(Boolean))].sort();

  const avisos = [];
  if (fora.length) {
    avisos.push(`${fora.length} rateio(s) do Cálculo não entram nesta emissão e ficaram de fora: `
      + `${fora.slice(0, 4).map((s) => s.historico).join(', ')}.`);
  }
  if (comNome < recibos.length) {
    avisos.push(`${recibos.length - comNome} de ${recibos.length} unidades sem condômino cadastrado.`);
  }
  if (emissao.quantidade != null && emissao.quantidade !== recibos.length) {
    avisos.push(`A emissão declara ${emissao.quantidade} unidades e o rateio traz ${recibos.length}.`);
  }

  return {
    condominio, mes, ano,
    competencia: `${MESES[mes] || '?'}/${ano}`,
    cabecalho: emissao.cabecalho,
    observacoes: emissao.observacoes,
    arrecadacoes, recibos, blocos, divergencias, avisos,
    total,
    totalEmissao: emissao.total,
    quantidadeEmissao: emissao.quantidade,
    comNome,
  };
}
