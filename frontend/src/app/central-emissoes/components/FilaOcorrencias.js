'use client';
import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { AlertTriangle, AlertCircle, Edit, ChevronRight, CheckCircle, Plus, User, Clock, Loader2, Activity } from 'lucide-react';

export default function FilaOcorrencias() {
  const supabase = createClient();
  const { profile } = useAuth();
  const [ocorrencias, setOcorrencias] = useState([]);
  const [abaAtiva, setAbaAtiva] = useState('todas');
  const [loading, setLoading] = useState(true);
  
  // Modal Creation States
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  // Drawer Details States
  const [showDrawer, setShowDrawer] = useState(false);
  const [itemAtivo, setItemAtivo] = useState(null);
  const [resposta, setResposta] = useState('');
  const [resolvendo, setResolvendo] = useState(false);

  const [condominios, setCondominios] = useState([]);
  const [pacotesDisponiveis, setPacotesDisponiveis] = useState([]);
  const [formData, setFormData] = useState({
    condominio_id: '',
    pacote_id: '',
    tipo: 'ocorrencia',
    descricao: ''
  });

  const fetchOcorrencias = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('emissoes_ocorrencias')
        .select(`
          *,
          condominios(name),
          profiles!criado_por(full_name)
        `)
        .order('criado_em', { ascending: false });
      
      if (error) throw error;
      setOcorrencias(data || []);
    } catch (err) {
      console.error('Erro ao buscar ocorrências:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCondominios = async () => {
    let query = supabase.from('condominios').select('id, name');
    
    if (profile?.role === 'gerente') {
      const { data: gerentes } = await supabase
        .from('gerentes')
        .select('id')
        .eq('profile_id', profile.id)
        .single();
      
      if (gerentes) {
        query = query.eq('gerente_id', gerentes.id);
      }
    }

    const { data } = await query.order('name');
    setCondominios(data || []);
  };

  const fetchPacotesDoCondo = async (condoId) => {
    if (!condoId) return;
    const { data } = await supabase
      .from('emissoes_pacotes')
      .select('id, mes_referencia, ano_referencia, status')
      .eq('condominio_id', condoId)
      .order('ano_referencia', { ascending: false })
      .order('mes_referencia', { ascending: false });
    
    setPacotesDisponiveis(data || []);
  };

  useEffect(() => {
    fetchOcorrencias();
    if (profile) fetchCondominios();
    
    const channel = supabase.channel('fila_ocorrencias')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_ocorrencias' }, () => {
        fetchOcorrencias();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile]);

  useEffect(() => {
    if (formData.condominio_id) {
      fetchPacotesDoCondo(formData.condominio_id);
    }
  }, [formData.condominio_id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.condominio_id || !formData.pacote_id || formData.descricao.length < 10) return;

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('emissoes_ocorrencias')
        .insert([{
          ...formData,
          criado_por: profile.id,
          criado_por_role: profile.role
        }]);

      if (error) throw error;
      
      setShowModal(false);
      setFormData({ condominio_id: '', pacote_id: '', tipo: 'ocorrencia', descricao: '' });
      fetchOcorrencias();
    } catch (err) {
      alert('Erro ao criar: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStatus = async (novoStatus) => {
    if (!itemAtivo) return;
    setResolvendo(true);
    
    try {
      const updates = {
        status: novoStatus,
        atualizado_em: new Date().toISOString()
      };

      if (novoStatus === 'resolvida') {
        if (!resposta) {
          alert('Por favor, informe a resposta/resolução.');
          setResolvendo(false);
          return;
        }
        updates.resposta = resposta;
        updates.resolvido_por = profile.id;
        updates.resolvido_em = new Date().toISOString();
      }

      const { error } = await supabase
        .from('emissoes_ocorrencias')
        .update(updates)
        .eq('id', itemAtivo.id);

      if (error) throw error;
      
      setShowDrawer(false);
      setItemAtivo(null);
      setResposta('');
      fetchOcorrencias();
    } catch (err) {
      alert('Erro ao atualizar: ' + err.message);
    } finally {
      setResolvendo(false);
    }
  };

  const abrirDetalhes = (item) => {
    setItemAtivo(item);
    setResposta(item.resposta || '');
    setShowDrawer(true);
  };

  const canResolve = ['master', 'departamento', 'supervisor_gerentes', 'supervisora_contabilidade', 'supervisora'].includes(profile?.role);

  const itensFiltrados = useMemo(() => {
    if (abaAtiva === 'todas') return ocorrencias;
    return ocorrencias.filter(o => o.tipo === abaAtiva);
  }, [ocorrencias, abaAtiva]);

  const contadorAbertas = ocorrencias.filter(o => o.status === 'aberta').length;

  return (
    <div className="border border-white/10 rounded-3xl bg-white/5 overflow-hidden shadow-2xl flex flex-col h-full min-h-[500px]">
      {/* Header */}
      <div className="p-6 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 flex items-center justify-center border border-rose-500/20">
            <AlertTriangle className="w-6 h-6 text-rose-400" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h3 className="font-black text-white text-lg uppercase tracking-tight">Fila de Conferência</h3>
              {contadorAbertas > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-black animate-pulse">
                  {contadorAbertas} ABERTAS
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 font-medium">Ocorrências e solicitações de alteração pendentes</p>
          </div>
        </div>
        
        <button 
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-all text-xs font-bold uppercase tracking-widest"
        >
          <Plus className="w-4 h-4 text-rose-400" />
          Nova
        </button>
      </div>

      {/* Tabs */}
      <div className="flex px-6 border-b border-white/10 bg-white/[0.01]">
        {[
          { id: 'todas', label: 'Todas' },
          { id: 'ocorrencia', label: 'Ocorrências' },
          { id: 'solicitacao', label: 'Alterações' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setAbaAtiva(tab.id)}
            className={`px-6 py-4 text-[10px] font-black uppercase tracking-widest transition-all border-b-2 ${
              abaAtiva === tab.id 
                ? 'border-rose-500 text-white bg-rose-500/5' 
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-12 gap-3">
            <Loader2 className="w-8 h-8 text-rose-500 animate-spin" />
            <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">Carregando fila...</p>
          </div>
        ) : itensFiltrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-20 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4 border border-emerald-500/20">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
            </div>
            <h4 className="text-white font-black text-lg uppercase tracking-tight">Tudo limpo!</h4>
            <p className="text-xs text-gray-500 max-w-[200px] mt-2">Nenhuma ocorrência ou solicitação pendente no momento.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {itensFiltrados.map(item => (
              <button 
                key={item.id}
                onClick={() => abrirDetalhes(item)}
                className="w-full px-6 py-5 flex items-center justify-between hover:bg-white/[0.02] transition-colors group text-left"
              >
                <div className="flex items-center gap-5">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
                    item.tipo === 'ocorrencia' 
                      ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' 
                      : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                  }`}>
                    {item.tipo === 'ocorrencia' ? <AlertCircle className="w-5 h-5" /> : <Edit className="w-5 h-5" />}
                  </div>
                  
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-sm font-bold text-white group-hover:text-rose-400 transition-colors">
                        {item.condominios?.name}
                      </span>
                      <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter ${
                        item.status === 'aberta' ? 'bg-rose-500 text-white' : 
                        item.status === 'analise' ? 'bg-amber-500 text-black' : 'bg-emerald-500 text-black'
                      }`}>
                        {item.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 line-clamp-1 mb-2">{item.descricao}</p>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <User className="w-3 h-3 text-gray-600" />
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{item.profiles?.full_name}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-gray-600" />
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                          {new Date(item.criado_em).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                
                <ChevronRight className="w-5 h-5 text-gray-700 group-hover:text-white transition-all transform group-hover:translate-x-1" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ═══ MODAL DE CRIAÇÃO ═══ */}
      {showModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-[#0a0a0f] border border-white/10 rounded-[2.5rem] w-full max-w-lg p-10 shadow-3xl animate-in zoom-in-95 duration-300">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-14 h-14 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center justify-center">
                <Plus className="w-7 h-7 text-rose-400" />
              </div>
              <div>
                <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Nova Ocorrência</h3>
                <p className="text-[10px] text-rose-400 font-black uppercase tracking-widest mt-1">Central de Fluxo</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                {/* Condomínio */}
                <div className="col-span-2">
                  <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">Condomínio</label>
                  <select
                    required
                    value={formData.condominio_id}
                    onChange={(e) => setFormData({ ...formData, condominio_id: e.target.value, pacote_id: '' })}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm text-white outline-none focus:border-rose-500 transition-all appearance-none"
                  >
                    <option value="" className="bg-[#0a0a0f]">Selecione o condomínio...</option>
                    {condominios.map(c => <option key={c.id} value={c.id} className="bg-[#0a0a0f]">{c.name}</option>)}
                  </select>
                </div>

                {/* Pacote */}
                <div className="col-span-2">
                  <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">Pacote de Emissão</label>
                  <select
                    required
                    disabled={!formData.condominio_id}
                    value={formData.pacote_id}
                    onChange={(e) => setFormData({ ...formData, pacote_id: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm text-white outline-none focus:border-rose-500 transition-all appearance-none disabled:opacity-30"
                  >
                    <option value="" className="bg-[#0a0a0f]">Selecione o pacote...</option>
                    {pacotesDisponiveis.map(p => (
                      <option key={p.id} value={p.id} className="bg-[#0a0a0f]">
                        Ref. {String(p.mes_referencia).padStart(2,'0')}/{p.ano_referencia} ({p.status})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Tipo */}
                <div className="col-span-2">
                  <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3 ml-1 text-center">Tipo de Pendência</label>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { id: 'ocorrencia', label: 'Ocorrência', desc: 'Erro na emissão' },
                      { id: 'solicitacao', label: 'Solicitação', desc: 'Alteração/Troca' }
                    ].map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setFormData({ ...formData, tipo: t.id })}
                        className={`p-4 rounded-2xl border-2 text-left transition-all ${
                          formData.tipo === t.id
                            ? 'border-rose-600 bg-rose-600/10 shadow-lg shadow-rose-600/10'
                            : 'border-white/5 bg-white/5 hover:border-white/10'
                        }`}
                      >
                        <p className={`text-xs font-black uppercase tracking-tight ${formData.tipo === t.id ? 'text-white' : 'text-gray-400'}`}>{t.label}</p>
                        <p className="text-[10px] text-gray-500">{t.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Descrição */}
                <div className="col-span-2">
                  <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">Descrição Detalhada</label>
                  <textarea
                    required
                    value={formData.descricao}
                    onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                    rows={4}
                    placeholder="Descreva o problema ou a alteração solicitada..."
                    className="w-full bg-white/5 border border-white/10 rounded-2xl p-5 text-sm text-white outline-none focus:border-rose-500 transition-all placeholder:text-gray-700 shadow-inner"
                  />
                  <p className="text-[9px] text-gray-600 mt-2 ml-1 uppercase font-bold tracking-widest">Mínimo 10 caracteres</p>
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-4 text-xs font-black text-gray-500 uppercase tracking-widest hover:text-white transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting || !formData.condominio_id || !formData.pacote_id || formData.descricao.length < 10}
                  className="flex-[2] py-4 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-black uppercase tracking-widest text-xs shadow-xl shadow-rose-600/20 transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Criar Pendência
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══ DRAWER DE DETALHES ═══ */}
      {showDrawer && itemAtivo && (
        <div className="fixed inset-0 z-[200] flex justify-end animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowDrawer(false)} />
          
          <div className="relative w-full max-w-md bg-[#0a0a0f] border-l border-white/10 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            {/* Header Drawer */}
            <div className="p-8 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
              <div>
                <h3 className="text-xl font-black text-white uppercase tracking-tight">Detalhes da Pendência</h3>
                <p className="text-[10px] text-rose-400 font-black uppercase tracking-widest mt-1">
                  ID: {itemAtivo.id.slice(0,8)}...
                </p>
              </div>
              <button onClick={() => setShowDrawer(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors text-gray-500 hover:text-white">
                <Plus className="w-6 h-6 rotate-45" />
              </button>
            </div>

            {/* Content Drawer */}
            <div className="flex-1 overflow-y-auto p-8 space-y-8">
              {/* Condomínio & Status */}
              <div className="flex items-start justify-between">
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Condomínio</label>
                  <p className="text-lg font-bold text-white leading-tight">{itemAtivo.condominios?.name}</p>
                </div>
                <div className="text-right">
                  <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Tipo</label>
                  <span className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest ${
                    itemAtivo.tipo === 'ocorrencia' ? 'bg-rose-500/10 text-rose-400' : 'bg-amber-500/10 text-amber-400'
                  }`}>
                    {itemAtivo.tipo}
                  </span>
                </div>
              </div>

              {/* Descrição */}
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">Descrição</label>
                <div className="p-5 bg-white/5 border border-white/10 rounded-2xl text-sm text-gray-300 leading-relaxed italic">
                  &quot;{itemAtivo.descricao}&quot;
                </div>
              </div>

              {/* Metadados */}
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/5">
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Criado por</label>
                  <div className="flex items-center gap-2">
                    <User className="w-3 h-3 text-rose-400" />
                    <span className="text-xs font-bold text-white">{itemAtivo.profiles?.full_name}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Data</label>
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3 text-rose-400" />
                    <span className="text-xs font-bold text-white">{new Date(itemAtivo.criado_em).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>

              {/* Área de Ação / Resolução */}
              <div className="pt-8 border-t border-white/10">
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-4 ml-1">Fluxo de Resolução</label>
                
                {itemAtivo.status === 'aberta' && (
                  <div className="space-y-4">
                    <div className="p-4 bg-rose-500/5 border border-rose-500/20 rounded-2xl flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center">
                        <AlertCircle className="w-5 h-5 text-rose-400" />
                      </div>
                      <p className="text-xs text-rose-200/60 font-medium leading-tight">Aguardando conferência inicial do departamento.</p>
                    </div>
                    {canResolve && (
                      <button
                        onClick={() => handleUpdateStatus('analise')}
                        disabled={resolvendo}
                        className="w-full py-4 rounded-2xl bg-amber-600 hover:bg-amber-500 text-white font-black uppercase tracking-widest text-xs transition-all shadow-xl shadow-amber-600/20 flex items-center justify-center gap-2"
                      >
                        {resolvendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                        Marcar em Análise
                      </button>
                    )}
                  </div>
                )}

                {itemAtivo.status === 'analise' && (
                  <div className="space-y-4">
                    <textarea
                      placeholder="Descreva aqui a resolution ou resposta para o gerente..."
                      value={resposta}
                      onChange={(e) => setResposta(e.target.value)}
                      rows={4}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl p-5 text-sm text-white outline-none focus:border-emerald-500 transition-all placeholder:text-gray-700"
                    />
                    {canResolve && (
                      <button
                        onClick={() => handleUpdateStatus('resolvida')}
                        disabled={resolvendo || !resposta}
                        className="w-full py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest text-xs transition-all shadow-xl shadow-emerald-600/20 flex items-center justify-center gap-2 disabled:opacity-30"
                      >
                        {resolvendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                        Resolver Pendência
                      </button>
                    )}
                  </div>
                )}

                {itemAtivo.status === 'resolvida' && (
                  <div className="space-y-4">
                    <div className="p-5 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl">
                      <div className="flex items-center gap-2 mb-3">
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                        <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Resolvido</span>
                      </div>
                      <p className="text-sm text-gray-300 leading-relaxed italic mb-4">&quot;{itemAtivo.resposta}&quot;</p>
                      <div className="text-[9px] text-gray-500 font-bold uppercase tracking-widest">
                        Resolvido em {new Date(itemAtivo.resolvido_em).toLocaleDateString()} às {new Date(itemAtivo.resolvido_em).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
