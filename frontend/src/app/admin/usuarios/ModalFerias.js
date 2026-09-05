'use client';
import { useState, useEffect, useMemo } from 'react';
import { apiFetch, apiPost } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { ROLE_LABELS } from '@/lib/roles';
import { comparaPorCodigo } from '@/lib/busca';
import { X, Loader2, CalendarDays, UserCheck, Trash2, Users } from 'lucide-react';

/**
 * Férias do gerente — a carteira responde por outras pessoas durante um período.
 *
 * A regra que dá forma à tela: **um condomínio, um responsável**. Não é uma
 * lista de pessoas que "ajudam"; é uma divisão. Por isso cada linha é um
 * condomínio com um seletor de quem responde por ele, e o que fica em branco
 * simplesmente não entra — melhor um condomínio parado com o dono do que dois
 * substitutos achando que o outro vai aprovar.
 *
 * O fim do período não tem botão: o acesso é calculado por data (0117), então
 * no dia seguinte ele deixa de valer sozinho. "Encerrar" existe só para quem
 * volta mais cedo.
 */
export default function ModalFerias({ usuario, onClose }) {
  const { addToast } = useToast();
  const gerenteId = usuario?.gerente_id_real;

  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [ausencias, setAusencias] = useState([]);
  const [pessoas, setPessoas] = useState([]);

  const hoje = new Date().toISOString().slice(0, 10);
  const [motivo, setMotivo] = useState('Férias');
  const [inicio, setInicio] = useState(hoje);
  const [fim, setFim] = useState(hoje);
  // { [condominio_id]: substituto_id }  — em branco = fica com o gerente
  const [destino, setDestino] = useState({});
  const [emMassa, setEmMassa] = useState('');
  // id do período que está sendo corrigido (null = abrindo um novo)
  const [editando, setEditando] = useState(null);

  const condos = useMemo(
    () => [...(usuario?.condominios || [])].sort((a, b) => comparaPorCodigo(a.name, b.name)),
    [usuario],
  );

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [lista, todos] = await Promise.all([
          gerenteId ? apiFetch(`/api/gerentes/${gerenteId}/ausencias`) : Promise.resolve({ ausencias: [] }),
          apiFetch('/api/usuarios/lista-completa').catch(() => ({ usuarios: [] })),
        ]);
        if (!vivo) return;
        const todas = lista?.ausencias || [];
        setAusencias(todas);
        if (lista?.aviso) addToast(lista.aviso, 'warning');

        // Um período aberto é o período sendo CORRIGIDO, não um novo.
        //
        // Sem carregar o que já vale, a tela dizia "0 de 30 com responsável"
        // com metade da carteira já entregue — e salvar criaria um segundo
        // período por cima, deixando o mesmo condomínio em duas mãos.
        const hojeStr = new Date().toISOString().slice(0, 10);
        const aberta = todas.find(a => !a.encerrada_em && a.data_fim >= hojeStr);
        if (aberta) {
          setEditando(aberta.id);
          setMotivo(aberta.motivo || 'Férias');
          setInicio(aberta.data_inicio);
          setFim(aberta.data_fim);
          setDestino(Object.fromEntries(
            (aberta.atribuicoes || []).map(x => [x.condominio_id, x.substituto_id]),
          ));
        }
        // Quem aprova alguma coisa no fluxo pode receber carteira.
        const podem = (todos?.usuarios || todos || []).filter(p =>
          ['master', 'gerente', 'departamento', 'supervisora', 'supervisora_contabilidade', 'supervisor_gerentes']
            .includes(p.role) && p.id !== usuario?.id);
        setPessoas(podem);
      } catch (e) {
        if (vivo) addToast('Não consegui carregar as férias: ' + (e.message || e), 'error');
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => { vivo = false; };
  }, [gerenteId, usuario?.id, addToast]);

  const atribuidos = Object.entries(destino).filter(([, v]) => v);
  const porPessoa = atribuidos.reduce((acc, [, pid]) => { acc[pid] = (acc[pid] || 0) + 1; return acc; }, {});

  function aplicarEmMassa() {
    if (!emMassa) return;
    setDestino(Object.fromEntries(condos.map(c => [c.id, emMassa])));
  }

  async function salvar() {
    if (!atribuidos.length) return addToast('Escolha quem responde por pelo menos um condomínio.', 'error');
    if (fim < inicio) return addToast('A data de volta é anterior à de saída.', 'error');
    setSalvando(true);
    try {
      const r = await apiPost(`/api/gerentes/${gerenteId}/ausencia`, {
        motivo: motivo.trim() || 'Férias',
        data_inicio: inicio,
        data_fim: fim,
        atribuicoes: atribuidos.map(([condominio_id, substituto_id]) => ({ condominio_id, substituto_id })),
      });
      addToast(
        `${r.atualizou ? 'Período atualizado' : 'Período aberto'}: ${r.condominios} condomínio(s) `
        + `para ${r.substitutos} pessoa(s). Elas foram avisadas.`,
        'success',
      );
      onClose(true);
    } catch (e) {
      addToast(e.message || 'Não consegui abrir o período', 'error');
    } finally {
      setSalvando(false);
    }
  }

  async function encerrar(id) {
    if (!window.confirm('Encerrar agora? Os condomínios voltam para o gerente imediatamente. O que já foi aprovado continua aprovado.')) return;
    try {
      await apiPost(`/api/ausencias/${id}/encerrar`, {});
      setAusencias(prev => prev.map(a => (a.id === id ? { ...a, encerrada_em: new Date().toISOString() } : a)));
      addToast('Carteira devolvida ao gerente.', 'success');
    } catch (e) {
      addToast(e.message || 'Não consegui encerrar', 'error');
    }
  }

  const fmt = (d) => { try { return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR'); } catch { return d; } };
  const vigente = (a) => !a.encerrada_em && a.data_inicio <= hoje && a.data_fim >= hoje;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-start justify-between px-7 pt-7 pb-4 shrink-0">
          <div>
            <h3 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-violet-500" /> Ausência de {usuario?.full_name}
            </h3>
            <p className="text-[11px] text-slate-500 mt-1">
              Reparta a carteira entre quem vai responder. No dia seguinte ao fim, tudo volta sozinho.
            </p>
          </div>
          <button onClick={() => onClose(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-7 pb-7 overflow-y-auto space-y-5">
          {carregando ? (
            <div className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin text-violet-500 mx-auto" /></div>
          ) : (
            <>
              {ausencias.length > 0 && (
                <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
                  {ausencias.map(a => (
                    <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        vigente(a) ? 'bg-amber-100 text-amber-800 border border-amber-300'
                        : a.encerrada_em ? 'bg-slate-100 text-slate-500 border border-slate-200'
                        : 'bg-slate-50 text-slate-500 border border-slate-200'}`}>
                        {vigente(a) ? 'EM CURSO' : a.encerrada_em ? 'ENCERRADA' : (a.data_inicio > hoje ? 'AGENDADA' : 'PASSADA')}
                      </span>
                      <span className="text-sm text-slate-800">{a.motivo}</span>
                      <span className="text-xs text-slate-500">{fmt(a.data_inicio)} a {fmt(a.data_fim)}</span>
                      <span className="text-xs text-slate-500">· {(a.atribuicoes || []).length} condomínio(s)</span>
                      <div className="flex-1" />
                      {vigente(a) && (
                        <button onClick={() => encerrar(a.id)}
                          className="text-[11px] font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1">
                          <Trash2 className="w-3.5 h-3.5" /> Encerrar agora
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {editando && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  Você está <strong>corrigindo o período que já está valendo</strong> — trocar um
                  responsável aqui muda quem responde a partir de agora. Um condomínio tem
                  sempre uma pessoa só.
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="fer-motivo" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Motivo</label>
                  <input id="fer-motivo" value={motivo} onChange={e => setMotivo(e.target.value)}
                    placeholder="Férias"
                    className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500" />
                </div>
                <div>
                  <label htmlFor="fer-ini" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sai em</label>
                  <input id="fer-ini" type="date" value={inicio} onChange={e => setInicio(e.target.value)}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500" />
                </div>
                <div>
                  <label htmlFor="fer-fim" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Volta em</label>
                  <input id="fer-fim" type="date" value={fim} min={inicio} onChange={e => setFim(e.target.value)}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500" />
                </div>
              </div>

              <div className="flex items-end gap-2 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                  <label htmlFor="fer-massa" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Passar tudo para uma pessoa
                  </label>
                  <select id="fer-massa" value={emMassa} onChange={e => setEmMassa(e.target.value)}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500">
                    <option value="">Escolha…</option>
                    {pessoas.map(p => <option key={p.id} value={p.id}>{p.full_name} — {ROLE_LABELS[p.role] || p.role}</option>)}
                  </select>
                </div>
                <button type="button" onClick={aplicarEmMassa} disabled={!emMassa}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40">
                  Aplicar a todos
                </button>
                <button type="button" onClick={() => setDestino({})}
                  className="px-3 py-2 rounded-xl text-xs text-slate-500 hover:text-slate-800">
                  Limpar
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2 flex-wrap">
                  <Users className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-[11px] font-bold text-slate-600">
                    {atribuidos.length} de {condos.length} condomínio(s) com responsável
                  </span>
                  {Object.entries(porPessoa).map(([pid, n]) => (
                    <span key={pid} className="text-[10px] rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 font-bold text-violet-700">
                      {(pessoas.find(p => p.id === pid)?.full_name || '?').split(' ')[0]}: {n}
                    </span>
                  ))}
                </div>
                <div className="max-h-[38vh] overflow-y-auto divide-y divide-slate-100">
                  {condos.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-slate-500">Este gerente não tem condomínios na carteira.</p>
                  ) : condos.map(c => {
                    const dono = pessoas.find(p => p.id === destino[c.id]);
                    return (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-2">
                      <span className="flex-1 min-w-0 text-sm text-slate-800 truncate">
                        {c.name}
                        {dono && (
                          <span className="ml-2 text-[11px] font-bold text-violet-700 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5">
                            {String(dono.full_name).split(' ')[0]}
                          </span>
                        )}
                      </span>
                      <select
                        value={destino[c.id] || ''}
                        onChange={e => setDestino(d => ({ ...d, [c.id]: e.target.value }))}
                        aria-label={`Quem responde por ${c.name}`}
                        className={`shrink-0 w-[210px] rounded-lg border px-2 py-1.5 text-xs outline-none ${
                          destino[c.id] ? 'border-violet-300 bg-violet-50 text-violet-800' : 'border-slate-200 bg-white text-slate-500'}`}>
                        <option value="">Fica com {String(usuario?.full_name || '').split(' ')[0]}</option>
                        {pessoas.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                      </select>
                    </div>
                    );
                  })}
                </div>
              </div>

              <p className="text-[11px] text-slate-500">
                Cada aprovação feita nesse período fica registrada com o contexto — <em>aprovado por Fulano · férias
                de {String(usuario?.full_name || '').split(' ')[0]}</em> — e aparece na trilha da emissão.
              </p>

              <div className="flex gap-3 pt-1">
                <button onClick={() => onClose(false)} disabled={salvando}
                  className="flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest text-slate-500 hover:bg-slate-100 disabled:opacity-30">
                  Cancelar
                </button>
                <button onClick={salvar} disabled={salvando || !atribuidos.length}
                  className="flex-[2] py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-40">
                  {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                  {editando ? 'Salvar alterações' : 'Abrir período'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
