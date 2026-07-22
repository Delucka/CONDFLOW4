'use client';

// Marca do CondoFlow — "Vizinhança": o conjunto de condomínios sob a mesma
// gestão. Três prédios de alturas diferentes, a praça e a árvore na frente,
// com a porta e uma janela acesa em laranja — é um lugar habitado, não um ícone.
//
// Herda a linguagem do mascote anterior (squircle claro com borda fina, dois
// tons de azul dando profundidade, laranja como acento pontual) e a identidade
// azul da administradora (Prop Starter, administração de imóveis desde 1993).
// Ver também: src/app/icon.svg e os ícones do PWA em public/.

export const NAVY = '#1e3a8a';   // prédios da frente
export const NAVY2 = '#2a4ba0';  // torre do fundo (profundidade)
export const LARANJA = '#f6883c';
export const CLARO = '#eef3fb';  // fundo do squircle / janelas

// A cena. `janela` permite trocar a cor das janelas quando o fundo muda.
function VizinhancaShapes({ janela = CLARO }) {
  return (
    <g>
      {/* torre alta (fundo) */}
      <rect x="45" y="23" width="25" height="56" rx="3.5" fill={NAVY2} />
      <g fill={janela}>
        <rect x="49" y="29" width="5" height="5" rx="1.2" /><rect x="60" y="29" width="5" height="5" rx="1.2" />
        <rect x="49" y="38" width="5" height="5" rx="1.2" /><rect x="60" y="38" width="5" height="5" rx="1.2" />
        <rect x="49" y="47" width="5" height="5" rx="1.2" />
        <rect x="49" y="56" width="5" height="5" rx="1.2" /><rect x="60" y="56" width="5" height="5" rx="1.2" />
      </g>
      <rect x="60" y="47" width="5" height="5" rx="1.2" fill={LARANJA} />

      {/* prédio esquerdo (frente) */}
      <rect x="16" y="41" width="26" height="38" rx="3.5" fill={NAVY} />
      <g fill={janela}>
        <rect x="20" y="47" width="5" height="5" rx="1.2" /><rect x="31" y="47" width="5" height="5" rx="1.2" />
        <rect x="20" y="56" width="5" height="5" rx="1.2" /><rect x="31" y="56" width="5" height="5" rx="1.2" />
      </g>
      <rect x="24" y="68" width="9" height="11" rx="2" fill={LARANJA} />

      {/* prédio direito (frente) */}
      <rect x="72" y="50" width="14" height="29" rx="3.5" fill={NAVY} />
      <g fill={janela}>
        <rect x="76" y="56" width="5" height="5" rx="1.2" /><rect x="76" y="65" width="5" height="5" rx="1.2" />
      </g>

      {/* praça e árvore */}
      <rect x="12" y="79" width="76" height="5" rx="2.5" fill="#c3d6f0" />
      <circle cx="43" cy="70" r="7" fill="#3f9c74" />
      <rect x="41.8" y="74" width="2.4" height="6" rx="1.2" fill="#2f7a5a" />
    </g>
  );
}

// Ícone completo (squircle claro) — sidebar, login, favicon, ícone do app.
export function LogoMark({ size = 36, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} role="img" aria-label="CondoFlow">
      <rect x="1.5" y="1.5" width="97" height="97" rx="26" fill={CLARO} stroke={NAVY} strokeOpacity="0.18" strokeWidth="1.5" />
      <VizinhancaShapes />
    </svg>
  );
}

// Sem o squircle — quando já existe uma superfície clara atrás.
export function LogoGlyph({ size = 36, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} role="img" aria-label="CondoFlow">
      <VizinhancaShapes />
    </svg>
  );
}

// Logo completo: ícone + wordmark (o nome do sistema).
export function CondoFlowLockup({ size = 36, className = '' }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} className="shrink-0" />
      <span className="text-lg font-black tracking-tight text-slate-900">
        Condo<span className="text-violet-600">Flow</span>
      </span>
    </div>
  );
}

export default LogoMark;
