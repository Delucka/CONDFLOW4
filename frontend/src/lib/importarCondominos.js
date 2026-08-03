// Importação da "Relação de Condôminos Simplificada" (PDF do sistema da administradora).
// Traz o condomínio (nome + CNPJ do cabeçalho) e as unidades com proprietário e contatos.
//
// Por que o PDF é lido AQUI e não no servidor: medindo o relatório do British Garden
// (7 páginas), o pdfplumber no backend levou 3,18s e o pdfjs no navegador 0,47s. A função
// do Vercel corta em 10s — 3,18s no MENOR condomínio da base não deixa margem para uma
// relação de 500 unidades. O pdfjs já é dependência do projeto.
//
// A GRAVAÇÃO continua no backend: `condominos` é dado pessoal (LGPD) e a migration 0071
// deixou a tabela com RLS sem policy pública, acessível só por service-role.

let _pdfjs = null;
async function getPdfjs() {
  if (!_pdfjs) {
    // Build legacy + worker self-hosted: mesmo par usado em lib/extrairEmissao.js.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    _pdfjs = pdfjs;
  }
  return _pdfjs;
}

/**
 * Texto do PDF na ORDEM VISUAL.
 *
 * Cuidado: a ordem crua dos itens do pdfjs não é a ordem de leitura. Concatenar `item.str`
 * neste relatório produz lixo — "CNPJ: 54.531.603/0001-49Condomínio: 0001 - ..." e
 * "0 000223A0011 PAULO..." com unidade e cliente trocados. Por isso agrupamos por Y
 * (com tolerância, porque a mesma linha varia frações de ponto) e ordenamos por X.
 */
export async function extrairTextoPdf(arrayBuffer) {
  const pdfjs = await getPdfjs();
  // Guardamos a tarefa: no pdfjs 6 quem tem destroy() é ela, não o documento
  // (o documento só expõe cleanup()) — chamar doc.destroy() estoura TypeError.
  const tarefa = pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer.slice(0)),
    isEvalSupported: false,
    standardFontDataUrl: '/pdfjs-standard-fonts/',
  });
  const doc = await tarefa.promise;

  let texto = '';
  try {
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const conteudo = await page.getTextContent();

      const linhas = new Map();
      for (const item of conteudo.items) {
        if (!item.str || !item.str.trim()) continue;
        const y = Math.round(item.transform[5]);
        // Casa com uma linha já aberta se estiver a até 2pt — a mesma linha do PDF
        // costuma vir com Y ligeiramente diferente entre os pedaços.
        let chave = y;
        for (const k of linhas.keys()) {
          if (Math.abs(k - y) <= 2) { chave = k; break; }
        }
        if (!linhas.has(chave)) linhas.set(chave, []);
        linhas.get(chave).push({ x: item.transform[4], s: item.str });
      }

      texto += [...linhas.entries()]
        .sort((a, b) => b[0] - a[0])                       // topo → base
        .map(([, itens]) => itens.sort((a, b) => a.x - b.x) // esquerda → direita
          .map((o) => o.s).join(' ').replace(/\s+/g, ' ').trim())
        .join('\n') + '\n';
      page.cleanup();
    }
  } finally {
    try { await tarefa.destroy(); } catch { /* já liberado */ }
  }
  return texto;
}

const soDigitos = (s) => (s ?? '').toString().replace(/\D/g, '');

// Marcadores de escopo dentro da agenda de contatos de uma unidade.
const ESCOPOS = [
  { re: /Cliente:/i, escopo: 'cliente' },
  { re: /Unidade:/i, escopo: 'unidade' },
  { re: /Locat[áa]rio:/i, escopo: 'locatario' },
];

const RE_CABECALHO = /Condom[ií]nio:\s*(\S+)\s*-\s*(.+?)\s+CNPJ:\s*([\d./-]+)/;
const RE_UNIDADE = /^(\d+)\s+(\S+)\s+(\d{6})\s+(.+?)\s+Cliente:/;
const RE_EMAIL = /[\w.\-+]+@[\w.\-]+\.\w{2,}/g;
const RE_TELEFONE = /(?:Telefone[^:]*|Celular\s*)[:]\s*([()\d\s.\-]{8,})/i;

/**
 * Interpreta o texto extraído. Devolve { condominio, linhas, erroGeral }.
 * Cada linha vira um registro de `condominos` — UMA POR E-MAIL, para que a regra
 * "boleto só para e-mail cadastrado" funcione com qualquer e-mail do proprietário.
 */
export function lerCondominos(texto) {
  const bruto = (texto || '').replace(/\r\n?/g, '\n');
  if (!bruto.trim()) {
    return { condominio: null, linhas: [], erroGeral: 'Não consegui ler texto nesse PDF.' };
  }

  const cab = RE_CABECALHO.exec(bruto);
  if (!cab) {
    return {
      condominio: null, linhas: [],
      erroGeral: 'Não achei o cabeçalho "Condomínio: … CNPJ: …". Esse PDF parece não ser a Relação de Condôminos.',
    };
  }
  const condominio = {
    codigo: cab[1].trim(),
    nome: cab[2].trim(),
    cnpj: soDigitos(cab[3]),
  };

  // 1ª passada: acha onde cada unidade começa.
  const todas = bruto.split('\n');
  const inicios = [];
  todas.forEach((linha, i) => {
    const m = RE_UNIDADE.exec(linha);
    if (m) inicios.push({ i, bloco: m[1], unidade: m[2], cliente: m[3], nome: m[4].trim() });
  });

  if (inicios.length === 0) {
    return { condominio, linhas: [], erroGeral: 'Li o cabeçalho, mas nenhuma unidade. O relatório pode estar vazio.' };
  }

  // 2ª passada: cada unidade fica com as linhas até a próxima.
  const linhas = [];
  inicios.forEach((u, k) => {
    const fim = k + 1 < inicios.length ? inicios[k + 1].i : todas.length;
    const trecho = todas.slice(u.i, fim);

    // Contatos por escopo. O texto da 1ª linha já vem depois de "Cliente:".
    const porEscopo = { cliente: { emails: [], tels: [] }, unidade: { emails: [], tels: [] }, locatario: { emails: [], tels: [] } };
    let atual = 'cliente';
    for (const linha of trecho) {
      for (const { re, escopo } of ESCOPOS) {
        if (re.test(linha)) { atual = escopo; break; }
      }
      const emails = linha.match(RE_EMAIL) || [];
      emails.forEach((e) => porEscopo[atual].emails.push(e.toLowerCase()));
      const tel = RE_TELEFONE.exec(linha);
      if (tel) {
        const d = soDigitos(tel[1]);
        if (d.length >= 8) porEscopo[atual].tels.push(d);
      }
    }

    const base = { unidade: u.unidade, bloco: u.bloco, cliente_codigo: u.cliente };

    // Proprietário: e-mails do escopo Cliente + os do escopo Unidade (o relatório usa
    // "Unidade:" para contatos alternativos do mesmo dono).
    const emailsDono = [...new Set([...porEscopo.cliente.emails, ...porEscopo.unidade.emails])];
    const telDono = porEscopo.cliente.tels[0] || porEscopo.unidade.tels[0] || null;

    if (emailsDono.length === 0) {
      // Sem e-mail a unidade não pode sumir: entra uma linha sem e-mail.
      linhas.push({ ...base, nome: u.nome, tipo: 'proprietario', email: null, telefone: telDono, responsavel_pagamento: true, sem_email: true });
    } else {
      emailsDono.forEach((email, idx) => {
        linhas.push({
          ...base, nome: u.nome, tipo: 'proprietario', email,
          telefone: idx === 0 ? telDono : null,
          // Só o 1º e-mail responde pelo pagamento; os demais existem para receber boleto.
          responsavel_pagamento: idx === 0,
        });
      });
    }

    // Locatário: o relatório não traz o nome dele, só contatos.
    const emailsLoc = [...new Set(porEscopo.locatario.emails)];
    const telLoc = porEscopo.locatario.tels[0] || null;
    emailsLoc.forEach((email) => {
      linhas.push({ ...base, nome: null, tipo: 'locatario', email, telefone: telLoc, responsavel_pagamento: false });
    });
    if (emailsLoc.length === 0 && telLoc) {
      linhas.push({ ...base, nome: null, tipo: 'locatario', email: null, telefone: telLoc, responsavel_pagamento: false });
    }
  });

  return {
    condominio: { ...condominio, unidades: inicios.length },
    linhas,
    erroGeral: null,
  };
}

// CNPJ formatado só para exibir (guardamos os dígitos).
export function exibirCnpj(d) {
  if (!d || d.length !== 14) return d || '—';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
