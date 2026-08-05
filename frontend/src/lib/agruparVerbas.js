'use client';

/**
 * Deduz a que grupo de emissão cada verba pertence, lendo o NOME dela.
 *
 * Existe porque o vencimento sempre foi escrito dentro do nome — era o único
 * lugar onde cabia antes da 0086:
 *
 *     CASA ZELADOR VENC 10
 *     CONSUMO DE ÁGUA - ZEL
 *     CONSUMO DE GÁS - ZEL
 *
 * São 26 condomínios com segundo vencimento. Reclassificar isso à mão, verba
 * por verba, é trabalho que a máquina faz melhor — o nome já diz a resposta.
 *
 * Conservador de propósito: só move o que tem sinal explícito. O que ficar
 * ambíguo (ex.: "CONSUMO DE ENERGIA - 2", onde "2" tanto pode ser segundo
 * medidor quanto segundo vencimento) fica onde está e aparece como "sem sinal".
 * Chutar aqui manda boleto no vencimento errado.
 */

// Palavras que aparecem em quase toda planilha e não distinguem nada.
const GENERICAS = new Set([
  'consumo', 'de', 'do', 'da', 'dos', 'das', 'e', 'agua', 'gas', 'energia',
  'luz', 'casa', 'fundo', 'reserva', 'condominio', 'taxa', 'rateio', 'novo',
  'venc', 'vencimento', 'dia', 'salario', 'ferias', 'decimo', 'terceiro',
  'total', 'valor', 'mes', 'extra', 'extras', 'cota', 'previsao', 'geral',
]);

const semAcento = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const tokens = (nome) =>
  semAcento(nome).split(/[^a-z0-9]+/).filter(Boolean);

/** Tokens que servem de marca de subgrupo: nada de genérico, nada de número. */
const marcadores = (nome) =>
  tokens(nome).filter(t => t.length >= 3 && !GENERICAS.has(t) && !/^\d+$/.test(t));

/** "zel" casa com "zelador": um é prefixo do outro, com 3+ letras. */
const parentes = (a, b) =>
  a === b || (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)));

/**
 * @param rateios  [{ id, nome, grupo_id }]
 * @param grupos   [{ id, nome, due_day }]  — grupos[0] é o "Geral"
 * @returns [{ rateio, grupoAtual, grupoNovo, motivo }]  só as que MUDAM,
 *          mais `semSinal` com as que não deram para decidir.
 */
export function proporAgrupamento(rateios, grupos) {
  const propostas = [];
  const semSinal = [];
  if (!grupos || grupos.length < 2) return { propostas, semSinal };

  const padrao = grupos[0].id;
  const grupoDe = (r) => r.grupo_id || padrao;
  const porId = Object.fromEntries(grupos.map(g => [g.id, g]));

  // ── Passo 1: sinal explícito no nome ──
  // "VENC 10", "VENCIMENTO 10", "DIA 10"  →  grupo cujo due_day é 10.
  // Ou o nome do grupo aparecendo dentro do nome da verba (grupo renomeado
  // para "Zelador" casa com "CASA ZELADOR").
  const decidido = new Map();   // rateio.id -> { grupoId, motivo }

  for (const r of (rateios || [])) {
    const nome = semAcento(r.nome);

    const mDia = nome.match(/\b(?:venc|vencimento|dia)\.?\s*(\d{1,2})\b/);
    if (mDia) {
      const dia = parseInt(mDia[1], 10);
      const g = grupos.find(x => Number(x.due_day) === dia);
      if (g) { decidido.set(r.id, { grupoId: g.id, motivo: `o nome diz "${mDia[0].trim()}"` }); continue; }
    }

    const gNome = grupos.find(x => {
      const n = semAcento(x.nome);
      return n.length >= 4 && !n.startsWith('geral') && !n.startsWith('vencimento dia') && nome.includes(n);
    });
    if (gNome) { decidido.set(r.id, { grupoId: gNome.id, motivo: `o nome cita "${gNome.nome}"` }); continue; }
  }

  // ── Passo 2: contágio por marca ──
  // "CASA ZELADOR VENC 10" caiu no dia 10 e trouxe a marca "zelador".
  // "CONSUMO DE ÁGUA - ZEL" tem "zel", parente de "zelador" — mesma turma.
  const marcasPorGrupo = new Map();   // grupoId -> Set de marcas
  for (const [rid, d] of decidido) {
    const r = rateios.find(x => x.id === rid);
    const set = marcasPorGrupo.get(d.grupoId) || new Set();
    marcadores(r.nome).forEach(m => set.add(m));
    marcasPorGrupo.set(d.grupoId, set);
  }
  // Marca que aparece em mais de um grupo não distingue nada — descarta.
  const contagem = new Map();
  for (const set of marcasPorGrupo.values()) for (const m of set) contagem.set(m, (contagem.get(m) || 0) + 1);
  for (const set of marcasPorGrupo.values()) for (const m of [...set]) if (contagem.get(m) > 1) set.delete(m);

  for (const r of (rateios || [])) {
    if (decidido.has(r.id)) continue;
    let achou = null;
    for (const [grupoId, marcas] of marcasPorGrupo) {
      for (const m of marcas) {
        if (marcadores(r.nome).some(t => parentes(t, m))) { achou = { grupoId, marca: m }; break; }
      }
      if (achou) break;
    }
    if (achou) decidido.set(r.id, { grupoId: achou.grupoId, motivo: `"${achou.marca}" é do mesmo conjunto` });
  }

  // ── Resultado: só o que muda de fato ──
  for (const r of (rateios || [])) {
    const d = decidido.get(r.id);
    if (!d) { semSinal.push(r); continue; }
    if (d.grupoId === grupoDe(r)) continue;   // já está certo
    propostas.push({
      rateio: r,
      grupoAtual: porId[grupoDe(r)] || null,
      grupoNovo: porId[d.grupoId] || null,
      motivo: d.motivo,
    });
  }

  return { propostas, semSinal };
}
