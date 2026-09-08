'use client';
import { useState, useMemo, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useToast } from '@/components/Toast';
import { apiPost } from '@/lib/api';
import { Send, Lock, CalendarPlus, Trash2, AlertTriangle, CheckCircle2, X, Loader2 } from 'lucide-react';

const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
               'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/**
 * Por que o mês ficou sem valores.
 *
 * Lista curta em vez de texto livre: motivo digitado à mão vira quarenta
 * redações da mesma coisa, e aí ninguém consegue contar quantos condomínios
 * estão parados esperando assembleia. O detalhe ao lado cobre o que a lista não
 * alcança.
 */
const MOTIVOS = [
  'Aguardando assembleia',
  'Aguardando previsão orçamentária',
  'Condomínio sem cobrança neste mês',
  'Outro',
];

const TIPOS = ['AGO', 'AGE', 'Reuniao'];
const rotuloTipo = (t) => (t === 'Reuniao' ? 'Reunião' : t);

/**
 * A tela que fecha o ciclo do gerente: escolher quais meses vão para a emissão.
 *
 * Ela existe porque preencher não é liberar. O gerente preenche a previsão
 * anual inteira e vai embora; sem esta parada, os meses ficam preenchidos e
 * ninguém emite — e ele não fica sabendo, porque para ele o trabalho terminou
 * quando os números entraram.
 *
 * Três coisas acontecem aqui, e as três vêm da operação, não do software:
 *
 *   • Assembleia prevista TRAVA o mês dela e os seguintes. Ela decide o
 *     orçamento; liberar antes é emitir o valor que ela vai mudar. A trava cai
 *     quando alguém marcar a assembleia como realizada — e é por isso que a
 *     marcação aparece aqui, aberta, em vez de mandar procurar onde se faz.
 *
 *   • Mês sem valores não é liberado, e precisa dizer por quê. Alguém vai
 *     perguntar por que dezembro está zerado.
 *
 *   • Nada com assembleia vem marcado por padrão. Marcar sozinho justamente o
 *     mês em que há uma decisão pendente é decidir no lugar de quem sabe.
 */
export default function ModalLiberarMeses({
  condoId, condoNome, ano, mesesComValor, edicoes, onFechar, onConcluido,
}) {
  const supabase = createClient();
  const { addToast } = useToast();

  const [alteracoes, setAlteracoes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [selecionados, setSelecionados] = useState(() => new Set());
  const [motivos, setMotivos] = useState({});      // { mes: {motivo, detalhe} }
  const [novaAlt, setNovaAlt] = useState({});      // { mes: {tipo, data, descricao} }
  const [salvando, setSalvando] = useState(false);
  const [ocupado, setOcupado] = useState(null);

  async function carregarAlteracoes() {
    const { data } = await supabase
      .from('alteracoes_rateio').select('*')
      .eq('condominio_id', condoId).eq('ano_referencia', ano)
      .order('mes_referencia');
    setAlteracoes(data || []);
    setCarregando(false);
  }
  useEffect(() => { carregarAlteracoes();   }, [condoId, ano]);

  // A primeira alteração ainda prevista trava dela em diante.
  const mesQueTrava = useMemo(() => {
    const previstas = alteracoes.filter(a => a.status === 'prevista').map(a => a.mes_referencia);
    return previstas.length ? Math.min(...previstas) : null;
  }, [alteracoes]);

  const linhas = useMemo(() => {
    const edPorMes = {};
    (edicoes || []).forEach(e => { edPorMes[e.mes_referencia] = e; });
    const meses = new Set([...(mesesComValor || []), ...Object.keys(edPorMes).map(Number)]);
    (alteracoes || []).forEach(a => meses.add(a.mes_referencia));

    return [...meses].sort((a, b) => a - b).map(mes => {
      const ed = edPorMes[mes];
      const temValor = (mesesComValor || []).includes(mes);
      const liberado = ed?.status === 'edicao_finalizada';
      const travado = mesQueTrava != null && mes >= mesQueTrava && !liberado;
      const daquele = alteracoes.filter(a => a.mes_referencia === mes);
      return { mes, ed, temValor, liberado, travado, alteracoes: daquele };
    });
  }, [mesesComValor, edicoes, alteracoes, mesQueTrava]);

  const altQueTrava = useMemo(
    () => alteracoes.find(a => a.status === 'prevista' && a.mes_referencia === mesQueTrava) || null,
    [alteracoes, mesQueTrava],
  );

  // Só entra na seleção o que pode de fato ser liberado.
  const liberaveis = linhas.filter(l => l.temValor && !l.liberado && !l.travado).map(l => l.mes);
  useEffect(() => {
    setSelecionados(new Set(liberaveis));
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [linhas.length, mesQueTrava]);

  function alternar(mes) {
    setSelecionados(prev => {
      const n = new Set(prev);
      if (n.has(mes)) n.delete(mes); else n.add(mes);
      return n;
    });
  }

  async function marcarRealizada(alt) {
    setOcupado('alt-' + alt.id);
    try {
      const { error } = await supabase.from('alteracoes_rateio')
        .update({ status: 'realizada' }).eq('id', alt.id);
      if (error) throw error;
      addToast(`${rotuloTipo(alt.tipo)} marcada como realizada. Os meses destravaram.`, 'success');
      await carregarAlteracoes();
    } catch (e) {
      addToast(e.message || 'Não foi possível marcar.', 'error');
    } finally { setOcupado(null); }
  }

  async function criarAlteracao(mes) {
    const nova = novaAlt[mes] || {};
    if (!nova.tipo || !nova.data) { addToast('Escolha o tipo e a data.', 'warning'); return; }
    setOcupado('nova-' + mes);
    try {
      const { error } = await supabase.from('alteracoes_rateio').insert({
        condominio_id: condoId, ano_referencia: ano, mes_referencia: mes,
        tipo: nova.tipo, data_evento: nova.data,
        descricao: (nova.descricao || '').trim() || null, status: 'prevista',
      });
      if (error) throw error;
      setNovaAlt(prev => ({ ...prev, [mes]: undefined }));
      addToast('Marcado. Este mês e os seguintes ficam travados até ela ser realizada.', 'success');
      await carregarAlteracoes();
    } catch (e) {
      addToast(e.message || 'Não foi possível marcar.', 'error');
    } finally { setOcupado(null); }
  }

  async function removerAlteracao(alt) {
    setOcupado('alt-' + alt.id);
    try {
      const { error } = await supabase.from('alteracoes_rateio').delete().eq('id', alt.id);
      if (error) throw error;
      await carregarAlteracoes();
    } catch (e) {
      addToast(e.message || 'Não foi possível remover.', 'error');
    } finally { setOcupado(null); }
  }

  async function salvarMotivo(mes) {
    const m = motivos[mes] || {};
    if (!m.motivo) return;
    try {
      await apiPost('/api/edicoes-mensais/motivo-sem-valores', {
        condominio_id: condoId, mes, ano, motivo: m.motivo, detalhe: m.detalhe || null,
      });
    } catch (e) {
      addToast('Não consegui guardar o motivo de ' + MESES[mes] + ': ' + e.message, 'error');
    }
  }

  async function confirmar() {
    setSalvando(true);
    try {
      // Os motivos vão primeiro: se a liberação falhar, a explicação do mês
      // vazio já está guardada — ela não depende de nada dar certo.
      for (const l of linhas) {
        if (!l.temValor && motivos[l.mes]?.motivo) await salvarMotivo(l.mes);
      }

      const escolhidos = [...selecionados];
      if (escolhidos.length) {
        const r = await apiPost('/api/edicoes-mensais/pre-aprovar', {
          condominio_id: condoId,
          competencias: escolhidos.map(m => ({ mes: m, ano })),
        });
        const n = r?.aprovadas ?? 0;
        if (n) addToast(`${n} ${n === 1 ? 'mês liberado' : 'meses liberados'} para emissão: ${(r.meses || []).join(', ')}.`, 'success');
        (r?.travados || []).forEach(t => addToast(t.mensagem, 'warning'));
        if (r?.puladas_em_branco?.length) addToast('Ficaram de fora: ' + r.puladas_em_branco.join(', ') + '.', 'warning');
      }
      onConcluido?.();
      onFechar?.();
    } catch (e) {
      addToast(e.message || 'Não foi possível liberar.', 'error');
    } finally { setSalvando(false); }
  }

  const nSel = selecionados.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white border border-slate-300 rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">

        <div className="px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Send className="w-5 h-5 text-violet-500 shrink-0" />
              <h3 className="text-base font-bold text-slate-800 truncate">Liberar meses para emissão</h3>
            </div>
            <button onClick={onFechar} className="text-slate-400 hover:text-slate-700 shrink-0" aria-label="Fechar">
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1 truncate">
            {condoNome} · valores salvos. Mês sem liberação não pode ser emitido.
          </p>
        </div>

        {/* Um mês travado explica a trava aqui em cima, uma vez, em vez de
            repetir a mesma frase em cada linha travada. */}
        {altQueTrava && (
          <div className="mx-6 mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 shrink-0">
            <p className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {rotuloTipo(altQueTrava.tipo)} de {MESES[altQueTrava.mes_referencia]} ainda consta como prevista
            </p>
            <p className="text-[11px] text-amber-800 mt-1">
              Ela decide o orçamento, então trava {MESES[altQueTrava.mes_referencia]} e os meses seguintes.
              Se já aconteceu, marque como realizada — os meses destravam na hora.
            </p>
            <button onClick={() => marcarRealizada(altQueTrava)} disabled={ocupado === 'alt-' + altQueTrava.id}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-amber-500 disabled:opacity-50">
              <CheckCircle2 className="w-3 h-3" />
              {ocupado === 'alt-' + altQueTrava.id ? 'Marcando…' : `Marcar ${rotuloTipo(altQueTrava.tipo)} como realizada`}
            </button>
          </div>
        )}

        <div className="px-6 py-3 space-y-2 overflow-y-auto flex-1">
          {carregando ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-violet-500" /></div>
          ) : linhas.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">Nenhum mês preenchido ainda.</p>
          ) : linhas.map(l => {
            const alt = l.alteracoes.find(a => a.status === 'prevista');
            const editandoNova = !!novaAlt[l.mes];

            if (l.liberado) {
              return (
                <div key={l.mes} className="flex items-start gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 opacity-60">
                  <Lock className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-700">
                      {MESES[l.mes]}
                      <span className="ml-2 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">já liberado</span>
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {l.ed?.liberado_em ? `Liberado em ${new Date(l.ed.liberado_em).toLocaleDateString('pt-BR')}. ` : ''}
                      Para mudar, peça reabertura.
                    </p>
                  </div>
                </div>
              );
            }

            const vazio = !l.temValor;
            const cor = vazio ? 'border-rose-300 bg-rose-50'
                      : l.travado ? 'border-amber-300 bg-amber-50'
                      : 'border-slate-200';

            return (
              <div key={l.mes} className={`rounded-xl border px-3 py-2.5 ${cor}`}>
                <div className="flex items-start gap-2.5">
                  <input type="checkbox" className="mt-1 w-4 h-4 accent-violet-600 shrink-0"
                    checked={selecionados.has(l.mes)}
                    disabled={vazio || l.travado}
                    onChange={() => alternar(l.mes)}
                    aria-label={`Liberar ${MESES[l.mes]}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-800 flex items-center gap-2 flex-wrap">
                      {MESES[l.mes]}
                      {vazio && <span className="rounded-md bg-rose-200 px-1.5 py-0.5 text-[10px] font-bold text-rose-900">sem valores</span>}
                      {!vazio && !l.travado && <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">preenchido</span>}
                      {alt && (
                        <span className="rounded-md bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                          {rotuloTipo(alt.tipo)}{alt.data_evento ? ` em ${new Date(alt.data_evento + 'T00:00:00').toLocaleDateString('pt-BR')}` : ''}
                        </span>
                      )}
                      {l.travado && !alt && <span className="rounded-md bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">travado</span>}
                    </p>

                    {vazio ? (
                      <>
                        <p className="text-[11px] text-rose-800 mt-0.5">
                          Não dá para liberar um mês vazio. Diga por que está sem valores — quem emite precisa saber.
                        </p>
                        <select value={motivos[l.mes]?.motivo || ''}
                          onChange={e => setMotivos(p => ({ ...p, [l.mes]: { ...p[l.mes], motivo: e.target.value } }))}
                          className="mt-2 w-full rounded-lg border border-rose-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none">
                          <option value="">Selecione o motivo</option>
                          {MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        {motivos[l.mes]?.motivo && (
                          <input placeholder="Detalhe, se precisar"
                            value={motivos[l.mes]?.detalhe || ''}
                            onChange={e => setMotivos(p => ({ ...p, [l.mes]: { ...p[l.mes], detalhe: e.target.value } }))}
                            className="mt-1.5 w-full rounded-lg border border-rose-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none" />
                        )}
                      </>
                    ) : l.travado ? (
                      <p className="text-[11px] text-amber-800 mt-0.5">
                        Travado pela assembleia acima. Marque-a como realizada para liberar este mês.
                      </p>
                    ) : null}

                    {/* Marcar assembleia aqui mesmo: é no momento de liberar que
                        o gerente lembra que tem uma marcada. */}
                    {alt ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button onClick={() => marcarRealizada(alt)} disabled={ocupado === 'alt-' + alt.id}
                          className="rounded-lg border border-amber-500 bg-white px-2.5 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50">
                          Marcar como realizada
                        </button>
                        <button onClick={() => removerAlteracao(alt)} disabled={ocupado === 'alt-' + alt.id}
                          className="text-slate-400 hover:text-rose-500" aria-label="Remover marcação">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        {alt.descricao && <span className="text-[11px] text-slate-500 truncate">{alt.descricao}</span>}
                      </div>
                    ) : editandoNova ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <select value={novaAlt[l.mes]?.tipo || ''}
                          onChange={e => setNovaAlt(p => ({ ...p, [l.mes]: { ...p[l.mes], tipo: e.target.value } }))}
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-800">
                          <option value="">tipo</option>
                          {TIPOS.map(t => <option key={t} value={t}>{rotuloTipo(t)}</option>)}
                        </select>
                        <input type="date" value={novaAlt[l.mes]?.data || ''}
                          onChange={e => setNovaAlt(p => ({ ...p, [l.mes]: { ...p[l.mes], data: e.target.value } }))}
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-800" />
                        <input placeholder="o que muda" value={novaAlt[l.mes]?.descricao || ''}
                          onChange={e => setNovaAlt(p => ({ ...p, [l.mes]: { ...p[l.mes], descricao: e.target.value } }))}
                          className="flex-1 min-w-[120px] rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-800" />
                        <button onClick={() => criarAlteracao(l.mes)} disabled={ocupado === 'nova-' + l.mes}
                          className="rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-violet-500 disabled:opacity-50">
                          Marcar
                        </button>
                        <button onClick={() => setNovaAlt(p => ({ ...p, [l.mes]: undefined }))}
                          className="text-slate-400 hover:text-slate-700 text-[11px]">cancelar</button>
                      </div>
                    ) : (
                      <button onClick={() => setNovaAlt(p => ({ ...p, [l.mes]: { tipo: '', data: '', descricao: '' } }))}
                        className="mt-2 inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
                        <CalendarPlus className="w-3 h-3" /> marcar AGO, AGE ou reunião
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-6 py-2.5 border-t border-slate-200 bg-slate-50 shrink-0">
          <p className="text-[11px] text-slate-600 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Não liberados ficam guardados como previsão. Ninguém emite até você liberar.
          </p>
        </div>

        <div className="px-6 py-3.5 border-t border-slate-200 flex justify-end gap-2 shrink-0">
          <button onClick={onFechar} disabled={salvando}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
            Sair sem liberar
          </button>
          <button onClick={confirmar} disabled={salvando}
            className="rounded-xl bg-violet-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-50">
            {salvando ? 'Liberando…' : nSel ? `Liberar ${nSel} ${nSel === 1 ? 'mês' : 'meses'}` : 'Salvar motivos'}
          </button>
        </div>
      </div>
    </div>
  );
}
