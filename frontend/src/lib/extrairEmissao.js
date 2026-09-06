// Extração de emissão: junta os anexos de um pacote num único PDF, na ordem de auditoria:
// 1 Emissão a processar · 2 Correios · 3 Seguros · 4 Água (fatura+relatório) ·
// 5 Gás (fatura+relatório) · 6 Energia · 7 Cobranças extras e salão · 8 Relatório de rateio.
// Só entra o que foi anexado (sem geração). Só PDF/imagem entram no PDF mesclado.
import { getArquivoUrlSeguro } from '@/lib/arquivo';

const norm = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

// Monta a lista ordenada de itens { arquivo_url|__attachment, arquivo_nome, formato }.
export function ordenarParaExtracao(arquivos = [], cobrancas = []) {
  const usados = new Set();
  const out = [];
  const add = (a) => {
    const key = a.__attachment || a.arquivo_url || a.id;
    if (!key || usados.has(key)) return;
    usados.add(key);
    out.push(a);
  };

  // ── Ordem manual primeiro (0092) ──
  // Quem arrastou os arquivos na tela decidiu a ordem, e essa decisão vence a
  // classificação automática abaixo. O `add` ignora repetido, então tudo que
  // entrar aqui simplesmente não entra de novo lá.
  //
  // Arquivo enviado depois de arrastar fica com `ordem` nula e cai na regra
  // automática, no fim — não some nem embaralha o que já estava ordenado.
  arquivos
    .filter((a) => Number.isFinite(a.ordem))
    .sort((a, b) => a.ordem - b.ordem)
    .forEach(add);

  const porCat = (cat) => arquivos.filter((a) => a.categoria === cat);
  const outrosSub = (...subs) =>
    arquivos.filter((a) => a.categoria === 'outros' && subs.some((s) => norm(a.subtipo) === norm(s)));
  const concessKeys = (...keys) =>
    arquivos.filter((a) => a.categoria === 'concessionaria' && keys.some((k) => norm(a.subtipo).includes(norm(k))));
  const relat = (serv) =>
    arquivos.filter((a) => a.categoria === 'relatorio_leitura' && norm(a.relatorio_tipo_servico) === serv);

  // 1 · Emissão a processar
  porCat('emissao').forEach(add);
  // 2 · Correios
  outrosSub('Correios').forEach(add);
  // 3 · Seguros
  outrosSub('Seguro', 'Seguros').forEach(add);
  // 4 · Água: fatura (SABESP) + relatório (água)
  concessKeys('sabesp', 'agua', 'água').forEach(add);
  relat('agua').forEach(add);
  // 5 · Gás: fatura (COMGAS) + relatório (gás)
  concessKeys('comgas', 'gas', 'gás').forEach(add);
  relat('gas').forEach(add);
  // 6 · Energia: fatura (ENEL)
  concessKeys('enel', 'energia', 'eletropaulo', 'cpfl', 'edp', 'light').forEach(add);
  // 7 · Cobranças extras (anexos) + salão de festas
  (cobrancas || []).forEach((c) => {
    (c.attachments || []).forEach((att) => add({ __attachment: att, arquivo_nome: `Cobranca_${c.descricao || c.description || ''}` }));
  });
  outrosSub('Salão de festas', 'Salao de festas').forEach(add);
  // 8 · Relatório de cálculo de rateio
  outrosSub('Relatório de Rateio', 'Relatorio de Rateio').forEach(add);

  // Catch-all: qualquer anexo restante (não classificado) entra no fim, pra nada se perder.
  arquivos.forEach(add);

  return out;
}

// ── ZIP com os ORIGINAIS, numerados na ordem de auditoria ─────────────────────────
// Caminho preferido para ARQUIVAR: os arquivos entram bit a bit, exatamente como o
// banco/concessionária emitiram (nada é re-renderizado), e vai um ÍNDICE junto.
// Sem mesclagem = sem risco de página em branco.
const CABECALHO_INDICE = [
  'Documentos da emissão, na ordem de auditoria:',
  '1 Emissão a processar · 2 Correios · 3 Seguros · 4 Água · 5 Gás · 6 Energia',
  '7 Cobranças extras e salão · 8 Relatório de rateio',
];

// Baixa 1 original. Devolve { blob } ou { erro }.
async function baixarOriginal(item) {
  const path = item.__attachment || item.arquivo_url;
  if (!path) return { erro: 'sem caminho' };
  try {
    const url = await getArquivoUrlSeguro(path, { stream: true }); // same-origin, sem CORS
    if (!url) return { erro: 'sem acesso' };
    const resp = await fetch(url);
    if (!resp.ok) return { erro: `falha HTTP ${resp.status}` };
    const blob = await resp.blob();
    if (!blob.size) return { erro: 'arquivo vazio' };
    return { blob };
  } catch {
    return { erro: 'falha ao baixar' };
  }
}

function montarIndice(linhas, pulados) {
  return [
    ...CABECALHO_INDICE,
    '',
    ...linhas,
    ...(pulados.length ? ['', 'Não incluídos:', ...pulados.map((p) => `  - ${p}`)] : []),
    '',
    `Gerado em ${new Date().toLocaleString('pt-BR')} — CondoFlow`,
    'Os arquivos são os originais, sem qualquer reprocessamento.',
  ].join('\r\n');
}

// Uma emissão -> ZIP com os arquivos numerados na raiz.
export async function montarZipEmissao(itens, onProgress) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const pulados = [];
  const linhas = [];
  let i = 0;
  let incluidos = 0;

  for (const item of itens) {
    i += 1;
    const nome = item.arquivo_nome || `arquivo_${i}`;
    onProgress?.(i, itens.length, nome);
    const { blob, erro } = await baixarOriginal(item);
    if (erro) { if (erro !== 'sem caminho') pulados.push(`${nome} (${erro})`); continue; }
    const seq = String(i).padStart(2, '0');
    zip.file(`${seq} - ${nome}`, blob);   // preserva o nome original
    linhas.push(`${seq}  ${nome}`);
    incluidos += 1;
  }

  if (incluidos === 0) return { blob: null, pulados, incluidos: 0 };
  zip.file('INDICE.txt', montarIndice(linhas, pulados));
  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, pulados, incluidos };
}

// Várias emissões -> ZIP com UMA PASTA por competência (ex.: "Agosto-2026/01 - …").
// grupos: [{ label, itens }]
export async function montarZipMulti(grupos, onProgress) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const pulados = [];
  const linhas = [];
  const total = grupos.reduce((s, g) => s + (g.itens?.length || 0), 0);
  let feitos = 0;
  let incluidos = 0;

  for (const g of grupos) {
    const pasta = String(g.label || 'emissao').replace(/[\\/:*?"<>|]/g, '-');
    linhas.push('', `[${pasta}]`);
    let i = 0;
    for (const item of (g.itens || [])) {
      i += 1; feitos += 1;
      const nome = item.arquivo_nome || `arquivo_${i}`;
      onProgress?.(feitos, total, nome);
      const { blob, erro } = await baixarOriginal(item);
      if (erro) { if (erro !== 'sem caminho') pulados.push(`${pasta}/${nome} (${erro})`); continue; }
      const seq = String(i).padStart(2, '0');
      zip.file(`${pasta}/${seq} - ${nome}`, blob);
      linhas.push(`  ${seq}  ${nome}`);
      incluidos += 1;
    }
  }

  if (incluidos === 0) return { blob: null, pulados, incluidos: 0 };
  zip.file('INDICE.txt', montarIndice(linhas, pulados));
  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, pulados, incluidos };
}

// ── Mesclagem: CÓPIA DE PÁGINA, nada de rasterizar ─────────────────────────────────
// Histórico: por um tempo esta função RENDERIZAVA cada página com pdf.js e embutia a
// imagem no PDF final. Foi aí que nasceu o "PDF em branco": os scans (Canon iR-ADV)
// guardam o texto numa camada JBIG2, que o pdf.js só decodifica com um módulo WASM.
// Quando esse módulo não carregava, o render desenhava só o fundo claro e **terminava
// sem erro** — página aparentemente vazia, e o fallback nunca era acionado.
//
// Medi o arquivo do usuário lado a lado (mesma escala, % de pixels escuros):
//   original 1,33%  ·  copyPages do pdf-lib 1,33%  ·  merge do pypdf 1,33%
// Ou seja: copiar página é FIEL. O defeito era só o rasterizador. Então copiamos —
// os objetos entram como estão, sem decodificar nada, sem WASM, sem depender do
// navegador. O que abre hoje continua abrindo igual depois de mesclado.

// Baixa 1 item e adiciona ao doc `merged`: PDF por cópia de páginas, imagem embutida.
// Falhas vão pra `pulados` (não abortam o resto).
async function mesclarItem(merged, PDFDocument, item, pulados, onProgress, idx, total) {
  const nome = item.arquivo_nome || 'arquivo';
  onProgress?.(idx, total, nome);
  const path = item.__attachment || item.arquivo_url;
  // Sem caminho gravado também é item que ficou de fora, e precisa ser dito.
  // Antes saía calado: o documento simplesmente não entrava no PDF e nada
  // avisava — a pessoa recebia um arquivo a menos sem saber que faltava.
  if (!path) { pulados.push(`${nome} (sem arquivo guardado)`); return; }

  let bytes;
  try {
    const url = await getArquivoUrlSeguro(path, { stream: true }); // fetch → same-origin, sem CORS
    if (!url) { pulados.push(`${nome} (sem acesso)`); return; }
    const resp = await fetch(url);
    if (!resp.ok) { pulados.push(`${nome} (falha HTTP ${resp.status})`); return; }
    bytes = await resp.arrayBuffer();
    if (!bytes || bytes.byteLength === 0) { pulados.push(`${nome} (arquivo vazio)`); return; }
  } catch {
    pulados.push(`${nome} (falha ao baixar)`);
    return;
  }

  const low = nome.toLowerCase();
  const fmt = norm(item.formato);
  const isPdf = low.endsWith('.pdf') || fmt === 'pdf';
  const isPng = low.endsWith('.png') || fmt === 'png';
  const isJpg = /\.jpe?g$/.test(low) || fmt === 'jpg' || fmt === 'jpeg';

  try {
    if (isPdf) {
      // SEM `ignoreEncryption`. Ler isto antes de mexer:
      //
      // Os PDFs que o sistema emissor gera vêm CIFRADOS — RC4 de 40 bits, senha
      // de usuário vazia, só para travar permissões. Qualquer visualizador
      // decifra sozinho e a pessoa nem percebe. O pdf-lib 1.17.1 NÃO decifra.
      //
      // Com `{ ignoreEncryption: true }` ele carregava assim mesmo e o
      // `copyPages` copiava os bytes AINDA CIFRADOS para um documento sem
      // dicionário de cifra. O arquivo saía com o tamanho certo, o número de
      // páginas certo, e todas as páginas em branco: nenhum fluxo descomprime
      // ("incorrect header check"). Reproduzido fora do navegador com os quatro
      // documentos do 025 - SUN GATE: 27 páginas, 27 vazias.
      //
      // Sem a flag, o pdf-lib recusa e diz por quê — e aí o item vai para
      // `pulados`, o que faz o plano B do servidor entrar. Lá quem junta é o
      // pikepdf, que decifra: os mesmos 27 arquivos saem com 0 páginas vazias.
      const src = await PDFDocument.load(bytes);
      const idxs = src.getPageIndices();
      if (idxs.length === 0) { pulados.push(`${nome} (sem páginas)`); return; }
      const pages = await merged.copyPages(src, idxs);
      pages.forEach((p) => merged.addPage(p));
    } else if (isPng || isJpg) {
      const img = isPng ? await merged.embedPng(bytes) : await merged.embedJpg(bytes);
      const page = merged.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else {
      pulados.push(`${nome} (não é PDF/imagem)`);
    }
  } catch (e) {
    // Cifrado é o caso COMUM aqui, não a exceção — vale nomear, porque a
    // mensagem é o que diz à pessoa que o servidor vai resolver.
    const cifrado = /encrypt/i.test(e?.name || '') || /encrypt/i.test(e?.message || '');
    pulados.push(cifrado
      ? `${nome} (protegido — só o servidor junta)`
      : `${nome} (não consegui mesclar)`);
  }
}

/**
 * Este PDF é dos que o navegador não consegue juntar?
 *
 * Serve para decidir o caminho ANTES de baixar tudo: se a emissão tem
 * documento cifrado, não adianta tentar no navegador — vai direto ao servidor.
 */
export function pdfPrecisaDoServidor(bytes) {
  try {
    // `/Encrypt` mora no trailer. Procurar no arquivo inteiro pode dar falso
    // positivo (a sequência pode aparecer dentro de um fluxo), e o falso
    // positivo aqui é inofensivo: manda para o servidor, que junta igual.
    const texto = new TextDecoder('latin1').decode(
      bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes,
    );
    return texto.includes('/Encrypt');
  } catch {
    return false;
  }
}

// Uma emissão: junta os itens num PDF único. Devolve { blob, pulados, totalPaginas }.
export async function montarPdfEmissao(itens, onProgress) {
  const { PDFDocument } = await import('pdf-lib');
  const merged = await PDFDocument.create();
  const pulados = [];
  let i = 0;
  for (const item of itens) { i += 1; await mesclarItem(merged, PDFDocument, item, pulados, onProgress, i, itens.length); }
  const blob = new Blob([await merged.save()], { type: 'application/pdf' });
  return { blob, pulados, totalPaginas: merged.getPageCount() };
}

/**
 * Várias emissões num PDF único.
 *
 * `grupos`: `[{ label, sublabel?, itens }]`.
 *
 * Devolve `{ blob, pulados, totalPaginas, paginasDeDocumento, capas }`.
 *
 * ── Por que `paginasDeDocumento` existe ──
 *
 * `totalPaginas` conta TUDO, inclusive as folhas de rosto que esta função
 * mesma acrescenta. Quando nenhum documento conseguia ser mesclado, o resultado
 * eram três folhas de rosto e `totalPaginas === 3` — e quem chamava, checando
 * `totalPaginas === 0` para detectar fracasso, achava que tinha dado certo.
 * Salvava o arquivo e anunciava "PDF gerado · 3 páginas". Eram três páginas
 * praticamente em branco.
 *
 * `paginasDeDocumento` conta só o que veio dos anexos. É esse o número que
 * responde "deu certo?".
 *
 * ── Por que a folha de rosto deixou de ser quase vazia ──
 *
 * Ela tinha duas linhas no alto de uma A4 e nada mais. Numa pilha impressa, é
 * uma folha branca a cada competência — papel gasto para separar. Agora carrega
 * o que a expedição precisa para conferir sem abrir o maço, e só aparece quando
 * há mais de uma competência: uma emissão sozinha não precisa ser separada de
 * nada.
 */
export async function montarPdfMulti(grupos, onProgress) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const merged = await PDFDocument.create();
  const font = await merged.embedFont(StandardFonts.HelveticaBold);
  const fontR = await merged.embedFont(StandardFonts.Helvetica);
  const pulados = [];
  const total = grupos.reduce((s, g) => s + (g.itens?.length || 0), 0);
  const comSeparador = grupos.length > 1;
  let i = 0;
  let capas = 0;

  for (const g of grupos) {
    if (comSeparador && g.label) { desenharFolhaDeRosto(merged, { font, fontR, rgb }, g); capas += 1; }
    for (const item of (g.itens || [])) { i += 1; await mesclarItem(merged, PDFDocument, item, pulados, onProgress, i, total); }
  }

  const totalPaginas = merged.getPageCount();
  const blob = new Blob([await merged.save()], { type: 'application/pdf' });
  return { blob, pulados, totalPaginas, paginasDeDocumento: totalPaginas - capas, capas };
}

// A folha de rosto de uma competência. Usada pelos dois caminhos de montagem.
function desenharFolhaDeRosto(doc, { font, fontR, rgb }, g) {
  const p = doc.addPage([595.28, 841.89]); // A4 retrato
  p.drawText(String(g.label), { x: 50, y: 770, size: 26, font, color: rgb(0.1, 0.1, 0.15) });
  p.drawLine({ start: { x: 50, y: 752 }, end: { x: 545, y: 752 }, thickness: 1, color: rgb(0.8, 0.82, 0.87) });
  if (g.sublabel) {
    p.drawText(String(g.sublabel), { x: 50, y: 726, size: 13, font: fontR, color: rgb(0.2, 0.2, 0.26) });
  }
  const itens = g.itens || [];
  const quantos = itens.length;
  p.drawText(`${quantos} documento${quantos === 1 ? '' : 's'} nesta competência`,
    { x: 50, y: 700, size: 11, font: fontR, color: rgb(0.42, 0.42, 0.48) });
  // A ordem impressa é a ordem de auditoria (1→8). Dizer isso na folha evita
  // que alguém reordene o maço achando que saiu embaralhado.
  p.drawText('Na ordem de conferência da emissão', { x: 50, y: 682, size: 9, font: fontR, color: rgb(0.55, 0.55, 0.6) });
  itens.slice(0, 30).forEach((it, n) => {
    const rotulo = `${String(n + 1).padStart(2, '0')}  ${it.arquivo_nome || 'documento'}`;
    p.drawText(rotulo.length > 82 ? rotulo.slice(0, 81) + '…' : rotulo,
      { x: 50, y: 650 - n * 15, size: 9, font: fontR, color: rgb(0.3, 0.3, 0.36) });
  });
  if (quantos > 30) {
    p.drawText(`… e mais ${quantos - 30}`, { x: 50, y: 650 - 30 * 15, size: 9, font: fontR, color: rgb(0.55, 0.55, 0.6) });
  }
}

/**
 * Junta PDFs que JÁ vêm prontos e limpos — os que o servidor montou.
 *
 * O servidor usa pikepdf, que decifra os originais; o que ele devolve não é
 * cifrado, e aí o pdf-lib consegue costurar sem estragar nada. É por isso que
 * este caminho existe separado de `montarPdfMulti`: lá as fontes vêm do bucket,
 * como foram anexadas, e podem estar cifradas.
 *
 * `partes`: `[{ label, sublabel, itens, bytes }]` — `itens` só alimenta a folha
 * de rosto; o conteúdo vem de `bytes`.
 */
export async function juntarPdfsProntos(partes) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const merged = await PDFDocument.create();
  const font = await merged.embedFont(StandardFonts.HelveticaBold);
  const fontR = await merged.embedFont(StandardFonts.Helvetica);
  const pulados = [];
  const comSeparador = partes.length > 1;
  let capas = 0;

  for (const parte of partes) {
    if (comSeparador && parte.label) { desenharFolhaDeRosto(merged, { font, fontR, rgb }, parte); capas += 1; }
    try {
      const src = await PDFDocument.load(parte.bytes);
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    } catch {
      pulados.push(`${parte.label || 'competência'} (não consegui juntar o PDF do servidor)`);
    }
  }

  const totalPaginas = merged.getPageCount();
  const blob = new Blob([await merged.save()], { type: 'application/pdf' });
  return { blob, pulados, totalPaginas, paginasDeDocumento: totalPaginas - capas, capas };
}
