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
 * Busca as verbas do mês. Devolve `[]` quando não há nada lançado — e aí não
 * vale desenhar página nenhuma: uma folha escrita "R$ 0,00" no meio do maço
 * afirma que a previsão é zero, o que é diferente de não ter sido preenchida.
 */
export async function buscarPlanilhaDoMes(supabase, condominioId, mes, ano) {
  const { data: verbas, error } = await supabase
    .from('rateios_config')
    .select('id, nome, ordem')
    .eq('condominio_id', condominioId)
    .order('ordem');
  if (error || !verbas?.length) return [];

  const ids = verbas.map((v) => v.id);
  const { data: valores } = await supabase
    .from('rateios_valores')
    .select('rateio_id, month, valor')
    .in('rateio_id', ids)
    .eq('ano', ano)
    .eq('month', mes);

  const porVerba = new Map((valores || []).map((v) => [v.rateio_id, v.valor]));
  return verbas
    .map((v) => ({ nome: v.nome, valor: porVerba.get(v.id) }))
    .filter((l) => l.valor !== undefined && l.valor !== null && Number(l.valor) !== 0);
}

/** Uma página A4 retrato com as verbas do mês. Devolve os bytes do PDF. */
export async function montarPlanilhaPdf({ condoNome, mes, ano, linhas }) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);

  const L = 595.28, A = 841.89, M = 50;
  const page = doc.addPage([L, A]);
  const cinza = rgb(0.42, 0.42, 0.48);
  const tinta = rgb(0.1, 0.1, 0.15);

  page.drawText('Planilha do gerente', { x: M, y: A - 70, size: 24, font: negrito, color: tinta });
  page.drawLine({ start: { x: M, y: A - 86 }, end: { x: L - M, y: A - 86 }, thickness: 1, color: rgb(0.8, 0.82, 0.87) });
  page.drawText(String(condoNome || ''), { x: M, y: A - 110, size: 13, font: fonte, color: rgb(0.2, 0.2, 0.26) });
  page.drawText(`${MESES[mes] || '?'}/${ano} · previsão lançada na tela de Arrecadações`,
    { x: M, y: A - 128, size: 10, font: fonte, color: cinza });

  // Cabeçalho da tabela
  let y = A - 168;
  page.drawRectangle({ x: M, y: y - 4, width: L - M * 2, height: 20, color: rgb(0.93, 0.94, 0.97) });
  page.drawText('VERBA', { x: M + 6, y: y + 2, size: 9, font: negrito, color: rgb(0.15, 0.15, 0.2) });
  page.drawText('VALOR', { x: L - M - 6 - negrito.widthOfTextAtSize('VALOR', 9), y: y + 2, size: 9, font: negrito, color: rgb(0.15, 0.15, 0.2) });
  y -= 24;

  let total = 0;
  linhas.forEach((l, i) => {
    if (y < M + 60) return;          // não estoura a página; o total continua correto
    if (i % 2 === 1) page.drawRectangle({ x: M, y: y - 4, width: L - M * 2, height: 18, color: rgb(0.975, 0.975, 0.985) });
    const nome = String(l.nome || '');
    page.drawText(nome.length > 58 ? `${nome.slice(0, 57)}…` : nome,
      { x: M + 6, y: y + 1, size: 10, font: fonte, color: rgb(0.2, 0.2, 0.26) });
    const texto = brl(l.valor);
    page.drawText(texto, { x: L - M - 6 - fonte.widthOfTextAtSize(texto, 10), y: y + 1, size: 10, font: fonte, color: rgb(0.2, 0.2, 0.26) });
    total += Number(l.valor || 0);
    y -= 18;
  });

  y -= 6;
  page.drawLine({ start: { x: M, y: y + 12 }, end: { x: L - M, y: y + 12 }, thickness: 1, color: rgb(0.8, 0.82, 0.87) });
  page.drawText('TOTAL', { x: M + 6, y: y - 6, size: 11, font: negrito, color: tinta });
  const totalTexto = brl(total);
  page.drawText(totalTexto, { x: L - M - 6 - negrito.widthOfTextAtSize(totalTexto, 11), y: y - 6, size: 11, font: negrito, color: tinta });

  page.drawText(`${linhas.length} verba${linhas.length === 1 ? '' : 's'} · gerado em ${new Date().toLocaleString('pt-BR')}`,
    { x: M, y: M, size: 8, font: fonte, color: rgb(0.6, 0.6, 0.65) });

  return doc.save();
}
