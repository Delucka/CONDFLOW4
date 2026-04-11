'use client';

import { useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useToast } from '@/components/Toast';

export default function CleanDuplicatesPage() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);

  async function handleClean() {
    setLoading(true);
    setResults([]);
    try {
      const supabase = createClient();
      
      // Busca todos os condominios ordenados pelo mais antigo
      const { data: allCondos, error: fetchError } = await supabase
        .from('condominios')
        .select('id, name')
        .order('created_at', { ascending: true });

      if (fetchError) throw fetchError;

      const seen = new Set();
      const toDelete = [];

      for (const c of allCondos) {
        if (seen.has(c.name)) {
          toDelete.push(c.id);
          setResults(prev => [...prev, `Marcado para exclusão: ${c.name} (${c.id})`]);
        } else {
          seen.add(c.name);
        }
      }

      if (toDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from('condominios')
          .delete()
          .in('id', toDelete);

        if (deleteError) throw deleteError;
        setResults(prev => [...prev, `\n\n✅ Sucesso! Foram excluídos ${toDelete.length} condomínios duplicados.`]);
        addToast(`${toDelete.length} duplicados excluídos!`, 'success');
      } else {
        setResults(['Nenhum condomínio duplicado encontrado.']);
        addToast('Nenhuma duplicata encontrada.', 'info');
      }
      
    } catch (err) {
      addToast('Erro: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-10 space-y-6">
      <h1 className="text-2xl font-bold text-slate-200">Limpeza de Duplicados</h1>
      <p className="text-slate-400">Clique no botão abaixo para encontrar e apagar versões duplicadas dos condomínios que foram importados mais de uma vez. O sistema manterá apenas 1 registro para cada nome.</p>
      
      <button 
        onClick={handleClean} 
        disabled={loading}
        className="px-6 py-3 bg-red-500 hover:bg-red-400 text-white font-bold rounded-lg shadow disabled:opacity-50 transition-colors"
      >
        {loading ? 'Limpando...' : 'Limpar Duplicados'}
      </button>

      <ul className="space-y-2 mt-6 max-h-96 overflow-y-auto">
        {results.map((msg, i) => (
          <li key={i} className="text-sm text-slate-300 font-mono whitespace-pre-wrap">
            {msg}
          </li>
        ))}
      </ul>
    </div>
  );
}
