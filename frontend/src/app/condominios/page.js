'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { apiFetcher, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { Building, PlusCircle, Pencil, Search, X, Loader2, User, Calendar, ShieldCheck } from 'lucide-react';

export default function CondominiosPage() {
  const { user } = useAuth();
  const { addToast } = useToast();

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({ id: '', name: '', due_day: '', gerente_id: '', assistente: '' });

  // SWR para Dados de Condomínios e Gerentes
  const { data: condosData, mutate: mutateCondos, isLoading: loadingCondos } = useSWR('/api/condominios', apiFetcher);
  const { data: usersData } = useSWR(user?.role === 'master' ? '/api/usuarios' : null, apiFetcher);

  const condos = condosData?.condos || [];
  const gerentes = (usersData?.usuarios || []).filter(u => u.role === 'gerente');

  const canEdit = user?.role === 'master';
  const filtered = condos.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  function openEdit(condo = null) {
    if (condo) {
      setFormData({ 
        id: condo.id, 
        name: condo.name, 
        due_day: condo.due_day || '', 
        gerente_id: condo.gerente_id || '', 
        assistente: condo.assistente || '' 
      });
    } else {
      setFormData({ id: '', name: '', due_day: '', gerente_id: '', assistente: '' });
    }
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setIsSaving(true);
    try {
      await apiPost('/api/condominios/salvar', formData);
      addToast(formData.id ? 'Condomínio atualizado!' : 'Novo condomínio cadastrado!', 'success');
      setModalOpen(false);
      mutateCondos(); // Atualiza a lista instantaneamente
    } catch (err) {
      addToast(err.message || 'Erro ao salvar', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="animate-fade-in w-full h-full relative space-y-8 pb-20">
      
      {/* Header com Busca e Ação */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 glass-panel p-8 rounded-[2rem] border-white/5 shadow-2xl">
        <div className="flex-1 w-full max-w-md relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within:text-cyan-400 transition-colors" />
          <input 
            type="text" 
            placeholder="Pesquisar condomínio..." 
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-slate-950 border border-white/5 rounded-2xl py-4 pl-12 pr-6 text-sm text-slate-200 outline-none focus:border-cyan-500/50 transition-all shadow-inner"
          />
        </div>

        {canEdit && (
          <button 
             onClick={() => openEdit()} 
             className="w-full md:w-auto bg-cyan-500 text-slate-950 px-8 py-4 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-cyan-400 shadow-xl shadow-cyan-500/20 active:scale-95 transition-all"
          >
            <PlusCircle className="w-5 h-5" /> NOVO CADASTRO
          </button>
        )}
      </div>

      {/* Grid de Condomínios */}
      {loadingCondos ? (
        <div className="p-24 text-center">
           <div className="w-10 h-10 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin mx-auto mb-4"></div>
           <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Sincronizando Base...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map(c => (
            <div key={c.id} className="glass-panel p-6 rounded-[2rem] border-white/5 hover:border-cyan-500/30 transition-all group shadow-xl flex flex-col justify-between">
                <div>
                   <div className="flex items-start justify-between mb-6">
                      <div className="w-14 h-14 bg-slate-900 rounded-2xl flex items-center justify-center border border-white/5 group-hover:scale-105 transition-transform">
                         <Building className="w-6 h-6 text-slate-500 group-hover:text-cyan-400" />
                      </div>
                      {canEdit && (
                        <button onClick={() => openEdit(c)} className="p-3 bg-white/5 hover:bg-cyan-500/10 text-slate-500 hover:text-cyan-400 rounded-xl transition-all border border-transparent hover:border-cyan-500/20">
                           <Pencil className="w-4 h-4" />
                        </button>
                      )}
                   </div>
                   
                   <h3 className="text-xl font-black text-white uppercase tracking-tight mb-6 leading-tight group-hover:text-cyan-400 transition-colors">
                      {c.name}
                   </h3>
                   
                   <div className="space-y-3 mb-8">
                      <div className="flex items-center gap-3 text-slate-400">
                         <User className="w-4 h-4 text-violet-400" />
                         <span className="text-xs font-bold">{c.gerente_name || 'Gerente não definido'}</span>
                      </div>
                      <div className="flex items-center gap-3 text-slate-400">
                         <Calendar className="w-4 h-4 text-cyan-500" />
                         <span className="text-xs font-bold">Vencimento: Dia {c.due_day || '—'}</span>
                      </div>
                      <div className="flex items-center gap-3 text-slate-400">
                         <ShieldCheck className="w-4 h-4 text-emerald-500" />
                         <span className="text-xs font-bold">Carteira: {c.assistente || 'Padrão'}</span>
                      </div>
                   </div>
                </div>

                <div className="pt-6 border-t border-white/5 flex gap-2">
                   <Link href={`/condominio/${c.id}/arrecadacoes`} className="flex-1 py-3 text-center bg-white/5 hover:bg-white/10 text-[10px] font-black text-slate-400 hover:text-white rounded-xl uppercase tracking-widest transition-all">Planilha</Link>
                   <Link href={`/condominio/${c.id}/cobrancas`} className="flex-1 py-3 text-center bg-white/5 hover:bg-white/10 text-[10px] font-black text-slate-400 hover:text-white rounded-xl uppercase tracking-widest transition-all">Extras</Link>
                </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de Cadastro/Edição */}
      {modalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-fade-in">
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md" onClick={() => setModalOpen(false)}></div>
          <div className="glass-panel max-w-xl w-full rounded-[2.5rem] relative animate-fade-up border border-white/10 shadow-3xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-8 border-b border-white/5 flex items-center justify-between">
              <h3 className="text-2xl font-black text-white uppercase tracking-tighter">
                {formData.id ? 'Ajustar Cadastro' : 'Novo Condomínio'}
              </h3>
              <button onClick={() => setModalOpen(false)} className="p-2 text-slate-500 hover:text-white transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={handleSave} className="p-8 space-y-6 overflow-y-auto">
              <div className="space-y-2">
                <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-1">Nome do condomínio</label>
                <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                       className="w-full bg-slate-950/50 border border-white/5 rounded-2xl p-4 text-sm text-slate-200 outline-none focus:border-cyan-500 shadow-inner" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-1">Dia de Vencimento</label>
                  <input type="number" min="1" max="31" value={formData.due_day} onChange={e => setFormData({...formData, due_day: e.target.value})}
                         className="w-full bg-slate-950/50 border border-white/5 rounded-2xl p-4 text-sm text-slate-200 outline-none focus:border-cyan-500 shadow-inner" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-1">Carteira / Assistente</label>
                  <input value={formData.assistente} onChange={e => setFormData({...formData, assistente: e.target.value})}
                         className="w-full bg-slate-950/50 border border-white/5 rounded-2xl p-4 text-sm text-slate-200 outline-none focus:border-cyan-500 shadow-inner" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-1">Gerente Responsável</label>
                <select required value={formData.gerente_id} onChange={e => setFormData({...formData, gerente_id: e.target.value})}
                        className="w-full bg-slate-950/50 border border-white/5 rounded-2xl p-4 text-sm text-slate-200 outline-none focus:border-cyan-500 shadow-inner cursor-pointer">
                  <option value="">Selecione um gerente...</option>
                  {gerentes.map(g => (
                    <option key={g.id} value={g.id}>{g.full_name}</option>
                  ))}
                </select>
              </div>
              
              <div className="pt-6">
                <button type="submit" disabled={isSaving} className="w-full py-5 bg-cyan-500 text-slate-950 font-black rounded-2xl hover:bg-cyan-400 transition-all uppercase tracking-[0.2em] text-xs shadow-2xl shadow-cyan-500/20 flex items-center justify-center gap-3 active:scale-95 disabled:opacity-50">
                  {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                  {formData.id ? 'SALVAR ALTERAÇÕES' : 'EFETIVAR CADASTRO'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
