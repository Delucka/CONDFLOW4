'use client';
import { CalendarRange } from 'lucide-react';

/**
 * O período de um relatório — em um lugar só, para os três dizerem a mesma coisa.
 *
 * Havia só Ano + Mês, o que trava a consulta na competência: dava para pedir
 * "Setembro de 2026" ou "2026 inteiro", e mais nada. Quem precisa de "de 10 de
 * março a 15 de abril" não tinha como pedir, e virava exportar o ano e filtrar
 * no Excel.
 *
 * Dois modos, e o seletor da esquerda diz qual está valendo:
 *
 *   COMPETÊNCIA  o mês a que a emissão se refere — `mes_referencia`/
 *                `ano_referencia`. É o recorte natural de quem trabalha por mês.
 *
 *   DATAS        um intervalo livre, aplicado à data que faz sentido para
 *                AQUELE relatório: quando a emissão foi criada, quando o
 *                trabalho entrou na expedição. Por isso `rotuloData` é
 *                obrigatório — sem dizer de que data se está falando, um
 *                intervalo é uma armadilha.
 */

export function periodoPadrao() {
  return { modo: 'competencia', ano: new Date().getFullYear(), mes: 0, de: '', ate: '' };
}

const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const diaBR = (iso) => {
  if (!iso) return '';
  try { return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR'); } catch { return iso; }
};

/** O período por extenso, para o subtítulo do PDF e para a tela. */
export function rotuloPeriodo(p) {
  if (p?.modo === 'datas') {
    if (p.de && p.ate) return `${diaBR(p.de)} a ${diaBR(p.ate)}`;
    if (p.de) return `de ${diaBR(p.de)} em diante`;
    if (p.ate) return `até ${diaBR(p.ate)}`;
    return 'todo o histórico';
  }
  return p?.mes ? `${MESES[p.mes]}/${p.ano}` : `Ano ${p?.ano}`;
}

/** Pedaço de nome de arquivo, sem espaço nem acento. */
export function sufixoPeriodo(p) {
  if (p?.modo === 'datas') return `${p.de || 'inicio'}_a_${p.ate || 'hoje'}`;
  return `${p?.mes ? String(p.mes).padStart(2, '0') + '-' : ''}${p?.ano}`;
}

/**
 * Aplica o período a uma consulta do Supabase.
 *
 * `colunaData` é a coluna de data DESTE relatório — a que o modo "datas"
 * filtra. O `ate` vira `< dia seguinte` porque a coluna guarda data e hora:
 * `lte('2026-03-15')` deixaria de fora tudo o que aconteceu no dia 15 depois
 * da meia-noite, ou seja, o dia inteiro.
 */
export function aplicarPeriodo(query, p, colunaData) {
  if (p?.modo === 'datas') {
    if (p.de) query = query.gte(colunaData, `${p.de}T00:00:00`);
    if (p.ate) {
      const seguinte = new Date(`${p.ate}T12:00:00`);
      seguinte.setDate(seguinte.getDate() + 1);
      query = query.lt(colunaData, `${seguinte.toISOString().slice(0, 10)}T00:00:00`);
    }
    return query;
  }
  query = query.eq('ano_referencia', p.ano);
  if (p.mes) query = query.eq('mes_referencia', p.mes);
  return query;
}

/** O mesmo recorte, para quem já tem as linhas na mão (filtro no cliente). */
export function dentroDoPeriodo(p, valorData, mes, ano) {
  if (p?.modo === 'datas') {
    if (!valorData) return false;
    const dia = String(valorData).slice(0, 10);
    if (p.de && dia < p.de) return false;
    if (p.ate && dia > p.ate) return false;
    return true;
  }
  if (ano !== p.ano) return false;
  return !p.mes || mes === p.mes;
}

export default function PeriodoRelatorio({ value, onChange, rotuloData, id }) {
  const p = value || periodoPadrao();
  const muda = (patch) => onChange({ ...p, ...patch });
  const anoAtual = new Date().getFullYear();
  const anos = Array.from({ length: 8 }, (_, i) => anoAtual - i);
  const campo = 'block mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500/60';

  return (
    <>
      <div>
        <label htmlFor={`${id}-modo`} className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Período por
        </label>
        <select id={`${id}-modo`} value={p.modo} onChange={(e) => muda({ modo: e.target.value })} className={campo}>
          <option value="competencia">Competência</option>
          <option value="datas">Data</option>
        </select>
      </div>

      {p.modo === 'competencia' ? (
        <>
          <div>
            <label htmlFor={`${id}-ano`} className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Ano</label>
            <select id={`${id}-ano`} value={p.ano} onChange={(e) => muda({ ano: Number(e.target.value) })} className={campo}>
              {anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-mes`} className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Mês</label>
            <select id={`${id}-mes`} value={p.mes} onChange={(e) => muda({ mes: Number(e.target.value) })} className={campo}>
              <option value={0}>Ano inteiro</option>
              {MESES.slice(1).map((nome, i) => <option key={nome} value={i + 1}>{nome}</option>)}
            </select>
          </div>
        </>
      ) : (
        <>
          <div>
            <label htmlFor={`${id}-de`} className="text-[10px] font-bold uppercase tracking-wider text-slate-500">De</label>
            <input id={`${id}-de`} type="date" value={p.de} max={p.ate || undefined}
              onChange={(e) => muda({ de: e.target.value })} className={campo} />
          </div>
          <div>
            <label htmlFor={`${id}-ate`} className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Até</label>
            <input id={`${id}-ate`} type="date" value={p.ate} min={p.de || undefined}
              onChange={(e) => muda({ ate: e.target.value })} className={campo} />
          </div>
          <p className="text-[11px] text-slate-500 flex items-center gap-1.5 pb-2">
            <CalendarRange className="w-3.5 h-3.5 text-violet-500 shrink-0" aria-hidden="true" />
            {/* Sem dizer de QUE data se trata, um intervalo é chute. */}
            Conta pela data {rotuloData}.
          </p>
        </>
      )}
    </>
  );
}
