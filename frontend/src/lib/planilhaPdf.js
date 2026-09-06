/**
 * A planilha do gerente virando página de PDF.
 *
 * Ela é o único item do maço que NÃO é um arquivo anexado: verba e valor moram
 * em `rateios_config` / `rateios_valores`, preenchidos na tela de Arrecadações.
 * Não havia como imprimi-la junto da emissão — e é ela que diz o que foi
 * definido, enquanto o resto do maço mostra o que saiu disso.
 *
 * Desenhada com pdf-lib, como os relatórios em tabela. Sai limpa (sem cifra),
 * então costura sem problema com o que o servidor devolve.
 */

const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * As verbas do mês e a liberação da planilha.
 *
 * Devolve `{ linhas, liberacao, motivo }`. `motivo` só vem quando não deu para
 * montar — e existe para a tela poder DIZER o que houve. A planilha não sair em
 * silêncio foi exatamente o problema que trouxe este arquivo à existência.
 *
 * A liberação é a assinatura da gerência: `edicoes_mensais.liberado_em` com o
 * nome de quem responde pela carteira. Sem ela, a folha seria uma tabela de
 * números sem dono nem data.
 */
export async function buscarPlanilhaDoMes(supabase, condominioId, mes, ano) {
  const { data: verbas, error } = await supabase
    .from('rateios_config')
    .select('id, nome, ordem')
    .eq('condominio_id', condominioId)
    .order('ordem');
  if (error) return { linhas: [], motivo: `não consegui ler as verbas (${error.message})` };
  if (!verbas?.length) return { linhas: [], motivo: 'este condomínio não tem verbas cadastradas' };

  const ids = verbas.map((v) => v.id);
  const { data: valores, error: errV } = await supabase
    .from('rateios_valores')
    .select('rateio_id, month, valor')
    .in('rateio_id', ids)
    .eq('ano', ano)
    .eq('month', mes);
  if (errV) return { linhas: [], motivo: `não consegui ler os valores (${errV.message})` };

  const porVerba = new Map((valores || []).map((v) => [v.rateio_id, v.valor]));
  const linhas = verbas
    .map((v) => ({ nome: v.nome, valor: porVerba.get(v.id) }))
    .filter((l) => l.valor !== undefined && l.valor !== null && Number(l.valor) !== 0);

  if (!linhas.length) return { linhas: [], motivo: 'não há verba lançada nesta competência' };

  // A assinatura. `edicao_finalizada` é o que a tela chama de "liberada".
  let liberacao = null;
  try {
    const { data: ed } = await supabase
      .from('edicoes_mensais')
      .select('status, liberado_em, gerentes(nome)')
      .eq('condominio_id', condominioId)
      .eq('ano_referencia', ano)
      .eq('mes_referencia', mes)
      .maybeSingle();
    if (ed) {
      liberacao = {
        status: ed.status,
        em: ed.liberado_em,
        por: Array.isArray(ed.gerentes) ? ed.gerentes[0]?.nome : ed.gerentes?.nome,
      };
    }
  } catch { /* sem a liberação a planilha ainda vale; só perde a assinatura */ }

  return { linhas, liberacao };
}

const dataHoraBR = (ts) => {
  try { return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
};

/**
 * A folha da planilha: verbas do mês e, em bloco separado, as cobranças extras.
 *
 * Separadas de propósito, com um total cada. Verba é o rateio que se divide
 * entre todas as unidades; cobrança extra é lançamento de uma unidade
 * específica — salão de festas, churrasqueira. Somar as duas num número só
 * responderia a uma pergunta que ninguém faz.
 */
export async function montarPlanilhaPdf({ condoNome, mes, ano, linhas, liberacao, cobrancas = [] }) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);

  const L = 595.28, A = 841.89, M = 50;
  let page = doc.addPage([L, A]);
  const cinza = rgb(0.42, 0.42, 0.48);
  const tinta = rgb(0.1, 0.1, 0.15);

  page.drawText('Planilha do gerente', { x: M, y: A - 70, size: 24, font: negrito, color: tinta });
  page.drawLine({ start: { x: M, y: A - 86 }, end: { x: L - M, y: A - 86 }, thickness: 1, color: rgb(0.8, 0.82, 0.87) });
  page.drawText(String(condoNome || ''), { x: M, y: A - 110, size: 13, font: fonte, color: rgb(0.2, 0.2, 0.26) });
  page.drawText(`${MESES[mes] || '?'}/${ano} · previsão lançada na tela de Arrecadações`,
    { x: M, y: A - 128, size: 10, font: fonte, color: cinza });

  // A assinatura da gerência: quem liberou e quando. É o que transforma a
  // tabela de números num documento com dono e data.
  let y = A - 168;
  if (liberacao) {
    const liberada = liberacao.status === 'edicao_finalizada' && liberacao.em;
    const quem = liberacao.por ? ` por ${liberacao.por}` : '';
    const texto = liberada
      ? `Planilha liberada${quem} em ${dataHoraBR(liberacao.em)}`
      : 'Planilha ainda em edição — os valores podem mudar';
    const cor = liberada ? rgb(0.09, 0.41, 0.29) : rgb(0.61, 0.24, 0.18);
    page.drawRectangle({
      x: M, y: y - 6, width: L - M * 2, height: 26,
      color: liberada ? rgb(0.91, 0.96, 0.94) : rgb(0.99, 0.94, 0.92),
    });
    page.drawText(texto, { x: M + 8, y: y + 2, size: 10, font: negrito, color: cor });
    y -= 44;
  }
  // ── Ferramentas de desenho que respeitam o fim da página ─────────────────
  //
  // Com 26 cobranças extras — o caso real do 0001 - BRITISH GARDEN — a folha
  // não cabe em uma página só. Cortar a lista faria o total não bater com o que
  // está impresso, que é o pior defeito possível num documento de conferência.
  const novaPagina = () => { page = doc.addPage([L, A]); y = A - M; };
  const espaco = (precisa) => { if (y - precisa < M + 30) novaPagina(); };

  const direita = (texto, yy, size, f, cor) =>
    page.drawText(texto, { x: L - M - 6 - f.widthOfTextAtSize(texto, size), y: yy, size, font: f, color: cor });

  const cabecalho = (esquerda, dir) => {
    espaco(30);
    page.drawRectangle({ x: M, y: y - 4, width: L - M * 2, height: 20, color: rgb(0.93, 0.94, 0.97) });
    page.drawText(esquerda, { x: M + 6, y: y + 2, size: 9, font: negrito, color: rgb(0.15, 0.15, 0.2) });
    direita(dir, y + 2, 9, negrito, rgb(0.15, 0.15, 0.2));
    y -= 24;
  };

  const escreverLinha = (texto, valor, i) => {
    espaco(20);
    if (i % 2 === 1) page.drawRectangle({ x: M, y: y - 4, width: L - M * 2, height: 18, color: rgb(0.975, 0.975, 0.985) });
    const t = String(texto || '');
    page.drawText(t.length > 58 ? `${t.slice(0, 57)}…` : t,
      { x: M + 6, y: y + 1, size: 10, font: fonte, color: rgb(0.2, 0.2, 0.26) });
    direita(brl(valor), y + 1, 10, fonte, rgb(0.2, 0.2, 0.26));
    y -= 18;
  };

  const escreverTotal = (rotulo, valor) => {
    espaco(30);
    page.drawLine({ start: { x: M, y: y + 12 }, end: { x: L - M, y: y + 12 }, thickness: 1, color: rgb(0.8, 0.82, 0.87) });
    page.drawText(rotulo, { x: M + 6, y: y - 6, size: 11, font: negrito, color: tinta });
    direita(brl(valor), y - 6, 11, negrito, tinta);
    y -= 30;
  };

  // ── Verbas do rateio ─────────────────────────────────────────────────────
  cabecalho('VERBA', 'VALOR');
  let somaVerbas = 0;
  linhas.forEach((l, i) => { escreverLinha(l.nome, l.valor, i); somaVerbas += Number(l.valor || 0); });
  escreverTotal('TOTAL DAS VERBAS', somaVerbas);

  // ── Cobranças extras, em bloco próprio ───────────────────────────────────
  if (cobrancas.length) {
    espaco(70);
    y -= 10;
    page.drawText('Cobranças extras', { x: M, y, size: 14, font: negrito, color: tinta });
    y -= 14;
    page.drawText('Lançamentos por unidade — não entram no rateio das verbas acima',
      { x: M, y, size: 9, font: fonte, color: cinza });
    y -= 18;

    cabecalho('DESCRIÇÃO / UNIDADE', 'VALOR');
    let somaCobrancas = 0;
    cobrancas.forEach((c, i) => {
      const desc = c.descricao || c.description || 'Cobrança';
      const un = c.unidades || c.unidade;
      const parcela = Number(c.parcela_total) > 1 ? ` (${c.parcela_atual}/${c.parcela_total})` : '';
      escreverLinha(`${desc}${un ? ` · ${un}` : ''}${parcela}`, c.valor ?? c.amount, i);
      somaCobrancas += Number(c.valor ?? c.amount ?? 0);
    });
    escreverTotal('TOTAL DAS COBRANÇAS EXTRAS', somaCobrancas);
  }

  espaco(20);
  const rodape = `${linhas.length} verba${linhas.length === 1 ? '' : 's'}`
    + (cobrancas.length ? ` · ${cobrancas.length} cobrança${cobrancas.length === 1 ? '' : 's'} extra${cobrancas.length === 1 ? '' : 's'}` : '')
    + ` · gerado em ${new Date().toLocaleString('pt-BR')}`;
  page.drawText(rodape, { x: M, y: Math.max(M, Math.min(y, M + 10)), size: 8, font: fonte, color: rgb(0.6, 0.6, 0.65) });

  return doc.save();
}
