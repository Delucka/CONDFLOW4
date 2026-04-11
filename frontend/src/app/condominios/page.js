'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { Building, PlusCircle, Pencil, Trash2, Search, X } from 'lucide-react';

export default function CondominiosPage() {
  const { user, profile } = useAuth();
  const { addToast } = useToast();

  const [condos, setCondos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({ id: '', name: '', due_day: '', gerente_id: '', assistente: '' });
  const [gerentes, setGerentes] = useState([]);

  useEffect(() => {
    async function carregar() {
      try {
        setLoading(true);
        const supabase = createClient();
        const canManage = ['master', 'emissor'].includes(user?.role) || ['master', 'emissor'].includes(profile?.role);
        const isGerente = user?.role === 'gerente' || profile?.role === 'gerente';

        let queryCondos = supabase.from('condominios').select('*, gerentes:gerente_id(profiles(full_name))').order('name');
        
        if (isGerente) {
          queryCondos = queryCondos.eq('gerente_id', user.id);
        }

        // Buscar gerentes: tenta tabela 'gerentes', senão busca profiles com role gerente
        let gerentesPromise = { data: [] };
        if (canManage) {
          gerentesPromise = supabase.from('gerentes').select('id, assistente, profiles(full_name)');
        }

        const [ { data: condos }, { data: resultGerentes } ] = await Promise.all([
          queryCondos,
          gerentesPromise
        ]);

        // Fallback: se tabela gerentes vazia, buscar profiles com role gerente
        let finalGerentes = resultGerentes || [];
        if (canManage && finalGerentes.length === 0) {
          const { data: profileGerentes } = await supabase.from('profiles').select('id, full_name').eq('role', 'gerente');
          finalGerentes = (profileGerentes || []).map(p => ({ id: p.id, profiles: { full_name: p.full_name } }));
        }

        const formattedCondos = (condos || []).map(c => {
           let gName = '—';
           if (c.gerentes?.profiles) {
               gName = Array.isArray(c.gerentes.profiles) ? c.gerentes.profiles[0]?.full_name : c.gerentes.profiles.full_name;
           }
           return { ...c, gerente_name: gName };
        });

        setCondos(formattedCondos);
        setGerentes(finalGerentes);
      } catch (err) {
        addToast(err.message || 'Erro ao carregar', 'error');
      } finally {
        setLoading(false);
      }
    }
    carregar();
  }, [addToast, user]);

  const canEdit = ['master', 'emissor'].includes(user?.role) || ['master', 'emissor'].includes(profile?.role);

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
    try {
      const supabase = createClient();
      const payload = {
         name: formData.name,
         due_day: parseInt(formData.due_day) || null,
         gerente_id: formData.gerente_id || null,
         assistente: formData.assistente || null
      };
      
      if (formData.id) {
         const { error } = await supabase.from('condominios').update(payload).eq('id', formData.id);
         if (error) throw error;
      } else {
         const { error } = await supabase.from('condominios').insert([payload]);
         if (error) throw error;
      }
      
      addToast('Condomínio salvo com sucesso!');
      setModalOpen(false);
      
      const { data: condos } = await supabase.from('condominios').select('*, gerentes:gerente_id(profiles(full_name))').order('name');
      const formattedCondos = (condos || []).map(c => {
           let gName = '—';
           if (c.gerentes?.profiles) {
               gName = Array.isArray(c.gerentes.profiles) ? c.gerentes.profiles[0]?.full_name : c.gerentes.profiles.full_name;
           }
           return { ...c, gerente_name: gName };
      });
      setCondos(formattedCondos);
    } catch (err) {
      addToast(err.message || 'Erro ao salvar condomínio', 'error');
    }
  }

  if (loading) return <div className="flex w-full justify-center p-20"><div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div></div>;

  return (
    <div className="animate-fade-in w-full h-full relative">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="relative flex-1 min-w-[250px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input 
            type="text" 
            placeholder="Buscar por nome..." 
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 pl-10 pr-4 text-sm text-slate-200 outline-none focus:border-cyan-500 transition-colors shadow-xl"
          />
        </div>

        {canEdit && (
          <button onClick={() => openEdit()} className="bg-cyan-500 text-slate-950 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)] transition-all">
            <PlusCircle className="w-4 h-4" /> Novo Condomínio
          </button>
        )}
      </div>

      <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left bg-slate-900">
            <thead>
              <tr className="bg-slate-800/50 border-b border-slate-800 text-[11px] uppercase tracking-wider font-semibold text-slate-400">
                <th className="px-5 py-4">Nome do Condomínio</th>
                <th className="px-5 py-4">Dia Venc.</th>
                <th className="px-5 py-4">Gerente</th>
                <th className="px-5 py-4">Assistente</th>
                {canEdit && <th className="px-5 py-4 text-right">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50 text-sm">
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-5 py-4 font-bold text-slate-200 flex items-center gap-2">
                    <Building className="w-4 h-4 text-slate-500" /> {c.name}
                  </td>
                  <td className="px-5 py-4 text-slate-400">{c.due_day || '—'}</td>
                  <td className="px-5 py-4 text-slate-400">{c.gerente_name || c.gerente_id || 'Não Definido'}</td>
                  <td className="px-5 py-4 text-slate-400">{c.assistente || '—'}</td>
                  
                  {canEdit && (
                    <td className="px-5 py-4 text-right space-x-2">
                      <button onClick={() => openEdit(c)} className="p-2 text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-lg transition-colors">
                        <Pencil className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan="5" className="px-5 py-10 text-center text-slate-500">
                    Nenhum condomínio encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && canEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm animate-fade-in p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-full">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-200">
                {formData.id ? 'Editar Condomínio' : 'Novo Condomínio'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-500 hover:text-slate-300 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSave} className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase">Nome</label>
                <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                       className="w-full bg-slate-800 rounded-lg p-3 text-sm text-slate-200 mt-1 outline-none focus:ring-1 focus:ring-cyan-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-slate-400 font-bold uppercase">Dia Vencimento</label>
                  <input type="number" min="1" max="31" value={formData.due_day} onChange={e => setFormData({...formData, due_day: e.target.value})}
                         className="w-full bg-slate-800 rounded-lg p-3 text-sm text-slate-200 mt-1 outline-none focus:ring-1 focus:ring-cyan-500" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 font-bold uppercase">Assistente/Carteira</label>
                  <input value={formData.assistente} onChange={e => setFormData({...formData, assistente: e.target.value})}
                         className="w-full bg-slate-800 rounded-lg p-3 text-sm text-slate-200 mt-1 outline-none focus:ring-1 focus:ring-cyan-500" />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase">Gerente Responsável</label>
                <select value={formData.gerente_id} onChange={e => setFormData({...formData, gerente_id: e.target.value})}
                        className="w-full bg-slate-800 rounded-lg p-3 text-sm text-slate-200 mt-1 outline-none focus:ring-1 focus:ring-cyan-500">
                  <option value="">-- Selecione o Gerente --</option>
                  {gerentes.map(g => (
                    <option key={g.id} value={g.id}>{g.profiles?.full_name || 'Usuário Sem Nome'}</option>
                  ))}
                </select>
              </div>
              
              <div className="pt-4 border-t border-slate-800">
                <button type="submit" className="w-full py-3 bg-cyan-500 text-slate-950 font-bold rounded-lg hover:bg-cyan-400 transition-colors uppercase tracking-wider text-xs shadow-lg shadow-cyan-500/20">
                  Salvar Condomínio
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
