/**
 * A Relação de Recibos em PDF — a mesma folha que o setor já usa.
 *
 * O desenho reproduz o documento que o usuário mandou de referência: assinatura
 * no canto superior esquerdo, uma linha por unidade com as arrecadações
 * empilhadas à direita, a Discriminação das verbas ao fim e, por último, as
 * observações do condomínio.
 *
 * Cores: a paleta do projeto. A rampa `violet` do `globals.css` é NAVY, não
 * roxo (ver a memória do tema 2026) — então os hexadecimais aqui são os mesmos
 * navy-600/700/100/50 que a tela usa.
 *
 * Desenhado com pdf-lib, como os outros relatórios: o PDF sai limpo (sem cifra)
 * e sem dependência nova. Coordenadas contadas DO TOPO, como no protótipo em
 * PyMuPDF que validamos; a conversão para o eixo do pdf-lib (origem embaixo)
 * acontece num lugar só, nos ajudantes de desenho.
 */
import { saveAs } from 'file-saver';

const L = 595, A = 842, M = 34;
const XB = M + 4, XU = M + 40, XC = M + 92, XR = M + 268, XH = M + 328, XV = L - M - 4;

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// As fontes padrão do PDF são WinAnsi: qualquer caractere fora dela faz o
// pdf-lib levantar erro no meio do desenho. Os dois anexos vêm de um sistema
// legado e volta e meia trazem um caractere de controle no meio do texto.
const FORA_DO_WINANSI = /[^\x20-\x7E\xA0-\xFF–—‘’“”•…€]/g;
const limpo = (s) => String(s ?? '').replace(FORA_DO_WINANSI, '');

/**
 * Os bytes do PDF. Separado do download para poder ser conferido fora do
 * navegador — foi assim que a folha foi validada contra o modelo do usuário.
 */
export async function desenharRecibosPdf({
  condominio, competencia, cabecalho = {}, recibos = [], arrecadacoes = [],
  divergencias = [], observacoes = [], bloco = '',
}) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);

  const NAVY = rgb(0.118, 0.227, 0.541);
  const NAVY_ESCURO = rgb(0.090, 0.145, 0.329);
  const NAVY_FAIXA = rgb(0.933, 0.949, 0.984);
  const NAVY_BORDA = rgb(0.859, 0.894, 0.961);
  const LARANJA = rgb(0.965, 0.533, 0.235);
  const PRETO = NAVY_ESCURO, CINZA = rgb(0.28, 0.31, 0.40), FRACO = rgb(0.55, 0.58, 0.66);

  // A assinatura. Falhar aqui não pode custar o relatório: sem o arquivo, sai
  // só o nome escrito.
  let logo = null;
  try {
    const r = await fetch('/email-logo.png');
    if (r.ok) logo = await doc.embedPng(await r.arrayBuffer());
  } catch { /* sem logo */ }

  const total = Math.round(recibos.reduce((t, x) => t + x.total, 0) * 100) / 100;
  const semNome = recibos.filter((x) => !x.condomino).length;

  let pg = null;
  let y = 0;   // contado do TOPO

  const larg = (txt, f, sz) => f.widthOfTextAtSize(limpo(txt), sz);
  const texto = (txt, x, yy, f, sz, cor) =>
    pg.drawText(limpo(txt), { x, y: A - yy, size: sz, font: f, color: cor });
  const dir = (txt, x, yy, f, sz, cor) => texto(txt, x - larg(txt, f, sz), yy, f, sz, cor);
  const corta = (txt, limite, f, sz) => {
    let s = limpo(txt);
    while (s && larg(s, f, sz) > limite) s = s.slice(0, -1);
    return s;
  };
  const linha = (yy, cor, esp) =>
    pg.drawLine({ start: { x: M, y: A - yy }, end: { x: L - M, y: A - yy }, thickness: esp, color: cor });
  const faixa = (yy) => pg.drawRectangle({
    x: M, y: A - (yy + 5), width: L - M * 2, height: 12,
    color: NAVY_FAIXA, borderColor: NAVY_BORDA, borderWidth: 0.5,
  });

  function nova() {
    pg = doc.addPage([L, A]);
    y = M + 4;
    if (logo) pg.drawImage(logo, { x: M, y: A - (y + 28), width: 30, height: 30 });
    texto('Condo', M + 37, y + 9, negrito, 12, NAVY_ESCURO);
    texto('Flow', M + 37 + larg('Condo', negrito, 12), y + 9, negrito, 12, NAVY);
    texto('Gestão de emissões condominiais', M + 37, y + 20, fonte, 6.5, FRACO);
    dir('Relação de Recibos', L - M, y + 9, negrito, 13, NAVY_ESCURO);
    dir(`Emitido em ${new Date().toLocaleString('pt-BR')} — Página ${doc.getPageCount()}`,
      L - M, y + 20, fonte, 6.5, FRACO);

    y += 34;
    linha(y - 6, NAVY, 1.2);
    y += 6;
    faixa(y);
    texto(`Condomínio: ${condominio || ''}`, M + 4, y, negrito, 7.5, PRETO);
    if (cabecalho.gerente) dir(`Gerente: ${cabecalho.gerente.slice(0, 42)}`, L - M - 4, y, negrito, 7.5, PRETO);
    y += 15;

    const resumo = [
      [`Emissão: ${cabecalho.emissao || '-'}`, `Vencimento: ${cabecalho.vencimento || '-'}`,
        `Competência: ${competencia || '-'}`],
      [`Unidades: ${recibos.length}${bloco ? ` (bloco ${bloco})` : ''}`,
        `Arrecadações: ${arrecadacoes.length}`,
        `Total${bloco ? ' do bloco' : ' geral'}: R$ ${brl(total)}`],
    ];
    for (const [a1, a2, a3] of resumo) {
      texto(a1, M + 4, y, fonte, 7, CINZA);
      texto(a2, M + 190, y, fonte, 7, CINZA);
      texto(a3, M + 360, y, fonte, 7, CINZA);
      y += 10;
    }
    if (cabecalho.conta) { texto(cabecalho.conta.slice(0, 112), M + 4, y, fonte, 7, CINZA); y += 12; }

    linha(y - 4, NAVY_BORDA, 0.8);
    y += 6;
    texto('Bloco', XB, y, negrito, 7, PRETO);
    texto('Unidade', XU, y, negrito, 7, PRETO);
    texto('Condômino', XC, y, negrito, 7, PRETO);
    texto('Histórico', XH, y, negrito, 7, PRETO);
    dir('Valor do recibo', XR, y, negrito, 7, PRETO);
    dir('Valor', XV, y, negrito, 7, PRETO);
    y += 4;
    linha(y, NAVY_BORDA, 0.8);
    y += 10;
  }

  // Quebra de página que respeita o bloco inteiro: um recibo com quatro
  // arrecadações não pode começar na última linha da folha.
  const espaco = (n) => { if (y + n > A - M - 14) nova(); };

  nova();
  for (const r of recibos) {
    espaco(10 + 9 * r.itens.length);
    texto(r.bloco || '', XB, y, fonte, 7.5, PRETO);
    texto(r.unidade, XU, y, fonte, 7.5, PRETO);
    // Cortado pela LARGURA disponível, não por número de caracteres: contar
    // letras deixava nome longo encostando no "Valor do recibo".
    texto(corta(r.condomino || '—', XR - XC - 52, fonte, 7.5), XC, y, fonte, 7.5, PRETO);
    dir(brl(r.total), XR, y, negrito, 7.5, NAVY);
    r.itens.forEach((i, k) => {
      if (k) y += 9;
      texto(i.historico.slice(0, 40), XH, y, fonte, 7, CINZA);
      dir(brl(i.valor), XV, y, fonte, 7, CINZA);
    });
    y += 12;
  }

  espaco(34 + 11 * arrecadacoes.length);
  y += 6;
  faixa(y);
  texto('Discriminação das verbas', M + 4, y, negrito, 8, PRETO);
  y += 16;
  for (const a of [...arrecadacoes].sort((x, z) => z.rateado - x.rateado)) {
    espaco(12);
    texto(a.rateio || '', M + 4, y, fonte, 7, FRACO);
    texto(a.historico.slice(0, 48), M + 44, y, fonte, 7.5, CINZA);
    texto(`${a.unidades} un.`, M + 330, y, fonte, 7, FRACO);
    dir(brl(a.rateado), XV, y, fonte, 7.5, CINZA);
    y += 11;
  }

  espaco(24);
  linha(y, NAVY_BORDA, 0.8);
  y += 12;
  texto('Total geral:', M + 4, y, negrito, 8.5, PRETO);
  dir(brl(total), XV, y, negrito, 8.5, NAVY);
  y += 14;

  // As notas de rodapé, e a divergência entre elas. Num documento de
  // conferência, esconder o que não bate é pior que não ter o documento.
  const notas = [];
  if (semNome) notas.push([`${semNome} de ${recibos.length} unidades sem condômino cadastrado (coluna com “—”).`, FRACO]);
  for (const d of divergencias) {
    notas.push([`${d.historico}: rateado ${brl(d.rateado)}, cobrado na emissão ${brl(d.cobrado)}.`, LARANJA]);
  }
  for (const [n, cor] of notas) {
    espaco(11);
    texto(n.slice(0, 120), M + 4, y, fonte, 6.5, cor);
    y += 9;
  }

  if (observacoes.length) {
    espaco(30 + 11 * observacoes.length);
    y += 14;
    faixa(y);
    texto('Observações do condomínio', M + 4, y, negrito, 8, PRETO);
    y += 16;
    for (const o of observacoes) {
      let atual = '';
      for (const palavra of String(o).split(/\s+/)) {
        if (atual && larg(`${atual} ${palavra}`, fonte, 7) > L - M * 2 - 8) {
          espaco(11);
          texto(atual, M + 4, y, fonte, 7, CINZA);
          y += 10;
          atual = palavra;
        } else {
          atual = atual ? `${atual} ${palavra}` : palavra;
        }
      }
      if (atual) { espaco(11); texto(atual, M + 4, y, fonte, 7, CINZA); y += 10; }
      y += 2;
    }
  }

  return { bytes: await doc.save(), paginas: doc.getPageCount() };
}

/** Desenha e baixa. */
export async function montarRecibosPdf({ filename = 'relacao_de_recibos', ...dados }) {
  const { bytes, paginas } = await desenharRecibosPdf(dados);
  saveAs(new Blob([bytes], { type: 'application/pdf' }),
    filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
  return paginas;
}
