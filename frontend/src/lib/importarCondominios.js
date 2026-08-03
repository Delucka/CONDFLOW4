// Importação de condomínios em lote — lê o que você colar direto do Excel
// (Ctrl+C nas células → Ctrl+V) ou um arquivo .csv exportado dele.
//
// Zero dependência de propósito: o projeto não tem lib de planilha e a política é
// não adicionar. Colar do Excel entrega TSV; salvar como CSV no Brasil costuma sair
// com ";". Detectamos o separador em vez de exigir um formato do usuário.

// Além dos acentos, converte os ordinais º ª ° — eles NÃO são diacríticos, então
// sobrevivem ao NFD e faziam "2º Vencimento" não casar com "2o vencimento".
const norm = (s) =>
  (s ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[º°]/g, 'o')
    .replace(/ª/g, 'a')
    .replace(/\s+/g, ' ')
    .trim();

// Cabeçalhos aceitos por campo. O primeiro que casar vence.
const COLUNAS = {
  name: ['nome', 'condominio', 'nome do condominio', 'name', 'descricao', 'razao social'],
  due_day: ['vencimento', 'dia de vencimento', 'dia', 'due day', 'due_day', '1o vencimento', '1 vencimento', 'venc', 'venc 1', 'vencimento 1'],
  due_day_2: ['2o vencimento', '2 vencimento', 'vencimento 2', 'due_day_2', 'venc 2', 'segundo vencimento'],
  cnpj: ['cnpj', 'cnpj do condominio'],
  gerente: ['gerente', 'gerente responsavel', 'responsavel', 'carteira', 'manager'],
};

// Descobre o separador olhando a 1ª linha: ganha o que aparecer mais.
function detectarSeparador(primeiraLinha) {
  const cand = ['\t', ';', ',', '|'];
  let melhor = '\t', max = 0;
  for (const c of cand) {
    const n = primeiraLinha.split(c).length - 1;
    if (n > max) { max = n; melhor = c; }
  }
  return max === 0 ? null : melhor;
}

// Divide respeitando aspas ("A, B" fica inteiro) — Excel exporta assim quando o
// próprio texto contém o separador.
function dividirLinha(linha, sep) {
  const out = [];
  let atual = '', dentroAspas = false;
  for (let i = 0; i < linha.length; i += 1) {
    const ch = linha[i];
    if (ch === '"') {
      if (dentroAspas && linha[i + 1] === '"') { atual += '"'; i += 1; }
      else dentroAspas = !dentroAspas;
    } else if (ch === sep && !dentroAspas) {
      out.push(atual); atual = '';
    } else {
      atual += ch;
    }
  }
  out.push(atual);
  return out.map((c) => c.trim());
}

function acharColuna(cabecalhos, alvos) {
  for (const alvo of alvos) {
    const i = cabecalhos.findIndex((h) => h === alvo);
    if (i >= 0) return i;
  }
  // Tolerância: cabeçalho que CONTÉM o termo ("nome do condomínio (obrigatório)")
  for (const alvo of alvos) {
    const i = cabecalhos.findIndex((h) => h.includes(alvo));
    if (i >= 0) return i;
  }
  return -1;
}

const soDigitos = (s) => (s ?? '').toString().replace(/\D/g, '');

function diaValido(v) {
  const s = (v ?? '').toString().trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  if (Number.isNaN(n) || n < 1 || n > 31) return NaN;   // NaN = inválido (≠ vazio)
  return n;
}

/**
 * Lê o texto colado/arquivo e devolve { linhas, mapeamento, erroGeral }.
 * Cada linha: { name, due_day, due_day_2, cnpj, gerente, problemas[] }
 */
export function lerCondominios(texto) {
  const bruto = (texto || '').replace(/\r\n?/g, '\n').trim();
  if (!bruto) return { linhas: [], mapeamento: {}, erroGeral: 'Cole os dados ou escolha um arquivo.' };

  const linhasTexto = bruto.split('\n').filter((l) => l.trim());
  if (linhasTexto.length < 2) {
    return { linhas: [], mapeamento: {}, erroGeral: 'Preciso de uma linha de cabeçalho e ao menos uma de dados.' };
  }

  const sep = detectarSeparador(linhasTexto[0]);
  if (!sep) {
    return { linhas: [], mapeamento: {}, erroGeral: 'Não achei separador de colunas. Copie as células direto do Excel ou salve como CSV.' };
  }

  const cabecalhos = dividirLinha(linhasTexto[0], sep).map(norm);
  const mapeamento = {};
  for (const [campo, alvos] of Object.entries(COLUNAS)) {
    mapeamento[campo] = acharColuna(cabecalhos, alvos);
  }

  if (mapeamento.name < 0) {
    return {
      linhas: [], mapeamento,
      erroGeral: `Não encontrei a coluna do nome. Cabeçalhos lidos: ${cabecalhos.join(' · ') || '(nenhum)'}. Renomeie a coluna para "Nome".`,
    };
  }

  const pega = (cels, campo) => (mapeamento[campo] >= 0 ? (cels[mapeamento[campo]] ?? '') : '');

  const linhas = [];
  const vistos = new Set();
  for (let i = 1; i < linhasTexto.length; i += 1) {
    const cels = dividirLinha(linhasTexto[i], sep);
    const name = pega(cels, 'name').trim();
    if (!name) continue;                       // linha vazia no meio da planilha

    const problemas = [];
    const d1 = diaValido(pega(cels, 'due_day'));
    const d2 = diaValido(pega(cels, 'due_day_2'));
    if (Number.isNaN(d1)) problemas.push('vencimento fora de 1–31');
    if (Number.isNaN(d2)) problemas.push('2º vencimento fora de 1–31');

    const cnpjDigitos = soDigitos(pega(cels, 'cnpj'));
    if (cnpjDigitos && cnpjDigitos.length !== 14) problemas.push('CNPJ não tem 14 dígitos');

    const chave = norm(name);
    if (vistos.has(chave)) problemas.push('repetido na própria planilha');
    vistos.add(chave);

    linhas.push({
      linha: i + 1,
      name,
      due_day: Number.isNaN(d1) ? null : d1,
      due_day_2: Number.isNaN(d2) ? null : d2,
      cnpj: cnpjDigitos || null,
      gerente: pega(cels, 'gerente').trim() || null,
      problemas,
    });
  }

  if (linhas.length === 0) {
    return { linhas: [], mapeamento, erroGeral: 'Nenhuma linha com nome preenchido.' };
  }
  return { linhas, mapeamento, erroGeral: null };
}

// Formata o CNPJ só para exibir na prévia (guardamos os dígitos).
export function exibirCnpj(d) {
  if (!d || d.length !== 14) return d || '—';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

// Modelo para o usuário baixar e preencher.
export const MODELO_CSV = [
  'Nome;Vencimento;2º Vencimento;CNPJ;Gerente',
  '001 - Cond. Ed. Exemplo;10;;12.345.678/0001-90;Suellen Teixeira',
  '002 - Cond. Ed. Outro;5;20;;',
].join('\r\n');
