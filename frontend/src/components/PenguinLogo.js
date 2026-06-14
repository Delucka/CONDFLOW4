'use client';

// Mascote oficial do CondoFlow: pinguim porteiro (corpo navy, barriga branca,
// bico laranja, gravata-borboleta azul) sobre squircle claro. Lê bem em tema
// claro e escuro e escala até favicon. Ver também src/app/icon.svg.

function PenguinShapes() {
  return (
    <g transform="translate(21.4,11) scale(0.65)">
      <path d="M14 46 Q0 66 14 94 Q20 82 22 60 Z" fill="#1e3a8a" />
      <path d="M74 46 Q88 66 74 94 Q68 82 66 60 Z" fill="#1e3a8a" />
      <path d="M44 6 C22 6 12 28 12 54 C12 66 14 80 16 90 C20 106 30 114 44 114 C58 114 68 106 72 90 C74 80 76 66 76 54 C76 28 66 6 44 6 Z" fill="#1e3a8a" />
      <ellipse cx="44" cy="72" rx="24" ry="36" fill="#ffffff" />
      <circle cx="35" cy="34" r="8" fill="#ffffff" />
      <circle cx="53" cy="34" r="8" fill="#ffffff" />
      <circle cx="36" cy="35" r="4" fill="#172554" />
      <circle cx="52" cy="35" r="4" fill="#172554" />
      <circle cx="34.5" cy="33" r="1.4" fill="#ffffff" />
      <circle cx="50.5" cy="33" r="1.4" fill="#ffffff" />
      <polygon points="44,42 53,49 44,56 35,49" fill="#f6883c" />
      <polygon points="30,58 30,72 44,65" fill="#3b6fe0" />
      <polygon points="58,58 58,72 44,65" fill="#3b6fe0" />
      <circle cx="44" cy="65" r="3.5" fill="#2a52c9" />
      <ellipse cx="33" cy="116" rx="10" ry="5" fill="#f6883c" />
      <ellipse cx="55" cy="116" rx="10" ry="5" fill="#f6883c" />
    </g>
  );
}

// Ícone quadrado (squircle claro) — usar na sidebar, no login e como favicon.
export function PenguinMark({ size = 36, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} role="img" aria-label="CondoFlow">
      <rect x="1.5" y="1.5" width="97" height="97" rx="26" fill="#eef3fb" stroke="#1e3a8a" strokeOpacity="0.18" strokeWidth="1.5" />
      <PenguinShapes />
    </svg>
  );
}

// Pinguim sem fundo (quando já houver um container/superfície clara atrás).
export function PenguinGlyph({ size = 36, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} role="img" aria-label="CondoFlow">
      <PenguinShapes />
    </svg>
  );
}

// Logo completo: ícone + wordmark CondoFlow (cores acompanham o tema).
export function CondoFlowLockup({ size = 36, className = '' }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <PenguinMark size={size} className="shrink-0" />
      <span className="text-lg font-black tracking-tight text-slate-900">
        Condo<span className="text-violet-600">Flow</span>
      </span>
    </div>
  );
}

export default PenguinMark;
