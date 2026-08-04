// Estilos de botão — fonte única para todas as telas.
//
// Formato "contorno" (opção B): SÓ a ação principal é preenchida. O resto é
// contorno ou texto. Numa tela com 4 botões por card, preencher todos faz nada
// se destacar — o olho não acha a ação certa.
//
// Regra de cor: navegação é NEUTRA. Verde, âmbar e vermelho ficam reservados
// para ESTADO (liberado, atenção, atrasado). Antes disso o app tinha 1.332 usos
// de rose/amber/emerald, quase todos decorativos, competindo com os alertas de
// verdade. A rampa `violet` é o navy da marca (remapeada no globals.css).
//
// Uso: className={btn.primario} · className={cn(btn.secundario, 'w-full')}

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl font-black uppercase ' +
  'tracking-widest transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

const ALTURA = 'px-5 py-3 text-[11px]';

export const btn = {
  // UMA por tela. Se houver duas, uma delas não é a principal.
  primario: `${BASE} ${ALTURA} bg-violet-600 hover:bg-violet-500 text-white`,

  // O padrão para quase tudo.
  secundario: `${BASE} ${ALTURA} bg-transparent border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400`,

  // Cancelar, voltar — não compete com nada.
  discreto: `${BASE} ${ALTURA} bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800`,

  // Destrutivo continua contorno: vermelho preenchido só em confirmação final.
  perigo: `${BASE} ${ALTURA} bg-transparent border border-rose-300 text-rose-600 hover:bg-rose-50 hover:border-rose-400`,

  // Menor, para barras densas.
  pequeno: `${BASE} px-3.5 py-2 text-[10px] bg-transparent border border-slate-300 text-slate-700 hover:bg-slate-50`,

  // SEMÂNTICO — só onde a cor carrega informação, não decoração.
  // Aprovar/liberar numa tela de aprovação: ali o verde É o significado, e a ação
  // é a principal da tela. Fora desse contexto, use `primario`.
  aprovar: `${BASE} ${ALTURA} bg-emerald-600 hover:bg-emerald-500 text-white`,
  // Recusar fica em contorno: preenchido vermelho só na confirmação final,
  // senão duas ações opostas competem com o mesmo peso.
  recusar: `${BASE} ${ALTURA} bg-transparent border border-rose-300 text-rose-600 hover:bg-rose-50 hover:border-rose-400`,

  // Só ícone: 44px de alvo (WCAG 2.5.5) via .tap. Exige aria-label.
  icone: 'tap inline-flex items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300 transition-colors disabled:opacity-40',
};

// Junta classes ignorando falsy — evita `className={`${a} ${b || ''}`}` espalhado.
export const cn = (...xs) => xs.filter(Boolean).join(' ');
