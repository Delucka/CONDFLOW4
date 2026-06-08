import Link from 'next/link';
import {
  Zap, Receipt, FileUp, FileCheck2, Droplet, LayoutDashboard, ShieldCheck,
  ArrowRight, Check, ScanLine, Building2,
} from 'lucide-react';

export const metadata = {
  title: 'CondoFlow — Gestão de Condomínios em um só lugar',
  description:
    'Arrecadações, cobranças, emissões com aprovação multinível, leitura automática de faturas e auditoria. A plataforma completa para administradoras e síndicos.',
};

const RECURSOS = [
  {
    icon: Receipt, tint: 'violet',
    titulo: 'Arrecadações & Rateios',
    desc: 'Planilha anual por condomínio, rateios e cobranças extras lançadas em poucos cliques — com histórico e bloqueio por mês.',
  },
  {
    icon: FileUp, tint: 'violet',
    titulo: 'Central de Emissões',
    desc: 'Monte o pacote de cada condomínio com boletos, faturas de concessionárias e relatórios — tudo organizado por mês.',
  },
  {
    icon: ScanLine, tint: 'emerald',
    titulo: 'Leitura automática de PDF',
    desc: 'Faturas da SABESP, COMGÁS e ENEL são lidas sozinhas: cliente, vencimento, valor e leitura por unidade extraídos na hora.',
  },
  {
    icon: FileCheck2, tint: 'amber',
    titulo: 'Aprovação multinível',
    desc: 'Fluxo de gerente → supervisores com auditoria, assinatura digital e solicitação de correção quando algo precisa de ajuste.',
  },
  {
    icon: Droplet, tint: 'violet',
    titulo: 'Consumos sob controle',
    desc: 'Matriz mensal de água, gás e energia por condomínio, com variação de consumo, alerta de anomalia e detecção de duplicata.',
  },
  {
    icon: ShieldCheck, tint: 'rose',
    titulo: 'Acessos & Auditoria',
    desc: 'Cada perfil vê só o que deve (síndico, gerente, supervisor, master). Toda ação fica registrada para prestação de contas.',
  },
];

const PASSOS = [
  { n: '1', titulo: 'Lance arrecadações', desc: 'Gerente registra a planilha do mês e as cobranças extras do condomínio.' },
  { n: '2', titulo: 'Monte a emissão', desc: 'O emissor anexa faturas e relatórios — lidos automaticamente — e vê a referência do gerente.' },
  { n: '3', titulo: 'Aprove com segurança', desc: 'O pacote passa pela aprovação multinível com assinatura e trilha de auditoria.' },
  { n: '4', titulo: 'Registre e acompanhe', desc: 'Emissão registrada, consumos atualizados e indicadores no painel central.' },
];

const TINTS = {
  violet:  'bg-violet-50 text-violet-600 ring-violet-100',
  emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  amber:   'bg-amber-50 text-amber-600 ring-amber-100',
  rose:    'bg-rose-50 text-rose-600 ring-rose-100',
};

function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="w-8 h-8 bg-violet-600 rounded-xl flex items-center justify-center text-white shrink-0">
        <Zap className="w-4 h-4 fill-white" />
      </span>
      <span className="text-lg font-black tracking-tight text-slate-900 italic">
        CONDO<span className="text-violet-600">FLOW</span>
      </span>
    </span>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-700">
      {/* ─── Nav ─── */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-slate-50/80 backdrop-blur-md">
        <nav className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-2 sm:gap-4">
            <a href="#recursos" className="hidden sm:inline-flex text-sm font-bold text-slate-500 hover:text-slate-900 px-3 py-2 rounded-lg transition-colors">
              Recursos
            </a>
            <a href="#como-funciona" className="hidden sm:inline-flex text-sm font-bold text-slate-500 hover:text-slate-900 px-3 py-2 rounded-lg transition-colors">
              Como funciona
            </a>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50"
            >
              Entrar <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </nav>
      </header>

      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden">
        {/* orbs decorativos (sutis, da identidade) */}
        <div className="pointer-events-none absolute -top-32 -left-24 w-[480px] h-[480px] bg-violet-500/10 rounded-full blur-[130px]" />
        <div className="pointer-events-none absolute -top-24 right-[-10%] w-[520px] h-[520px] bg-violet-500/10 rounded-full blur-[150px]" />

        <div className="relative max-w-6xl mx-auto px-5 pt-16 pb-12 md:pt-24 md:pb-20 grid lg:grid-cols-2 gap-12 items-center">
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-50 text-violet-700 text-xs font-black uppercase tracking-widest ring-1 ring-violet-100">
              <Building2 className="w-3.5 h-3.5" /> Gestão de condomínios
            </span>
            <h1 className="mt-5 text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-slate-900 leading-[1.05]">
              Toda a gestão do condomínio em <span className="text-violet-600">um só lugar</span>.
            </h1>
            <p className="mt-5 text-lg text-slate-500 leading-relaxed max-w-xl">
              Arrecadações, cobranças, emissões com aprovação multinível e leitura automática de faturas.
              Menos planilha solta, mais controle — do lançamento à prestação de contas.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-violet-600 text-white font-bold hover:bg-violet-700 transition-colors shadow-lg shadow-violet-600/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50"
              >
                Acessar o sistema <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="#recursos"
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-white text-slate-700 font-bold border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
              >
                Ver recursos
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
              {['Leitura automática de faturas', 'Aprovação multinível', 'Auditoria completa'].map(t => (
                <li key={t} className="inline-flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-500" /> {t}
                </li>
              ))}
            </ul>
          </div>

          {/* Mock visual do app (sem imagem — puro CSS) */}
          <div className="relative animate-fade-up" style={{ animationDelay: '120ms' }}>
            <div className="glass-panel rounded-3xl p-3 shadow-xl shadow-slate-900/5">
              <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
                {/* barra de janela */}
                <div className="flex items-center gap-1.5 px-4 h-9 border-b border-slate-200 bg-slate-50">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-300" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-300" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-300" />
                  <span className="ml-3 text-[10px] font-bold text-slate-400">app.condoflow</span>
                </div>
                {/* corpo mock */}
                <div className="flex">
                  <div className="hidden sm:flex flex-col gap-2 w-32 shrink-0 p-3 border-r border-slate-200 bg-slate-50/60">
                    {[LayoutDashboard, Receipt, Droplet, FileUp, ShieldCheck].map((Ic, i) => (
                      <div key={i} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-[10px] font-bold ${i === 2 ? 'bg-violet-600 text-white' : 'text-slate-400'}`}>
                        <Ic className="w-3.5 h-3.5" /> <span className="w-12 h-1.5 rounded bg-current opacity-40" />
                      </div>
                    ))}
                  </div>
                  <div className="flex-1 p-4 space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                      {[['Processadas', 'text-slate-900'], ['Anomalias', 'text-amber-600'], ['Total', 'text-emerald-600']].map(([t, c]) => (
                        <div key={t} className="rounded-xl border border-slate-200 p-2.5">
                          <p className="text-[8px] uppercase tracking-widest text-slate-400 font-black">{t}</p>
                          <p className={`text-lg font-black ${c}`}>{t === 'Total' ? 'R$ 25k' : t === 'Anomalias' ? '1' : '24'}</p>
                        </div>
                      ))}
                    </div>
                    {/* mini matriz */}
                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[9px] font-black uppercase tracking-widest text-slate-400">
                        Consumos · matriz mensal
                      </div>
                      <div className="p-3 space-y-2">
                        {[['SABESP', 'bg-emerald-100 ring-1 ring-emerald-200'], ['COMGÁS', 'bg-amber-100 ring-1 ring-amber-200'], ['ENEL', 'bg-violet-100 ring-1 ring-violet-200']].map(([n, cell]) => (
                          <div key={n} className="flex items-center gap-2">
                            <span className="text-[9px] font-black w-14 text-slate-500">{n}</span>
                            <span className="flex-1 grid grid-cols-6 gap-1">
                              {Array.from({ length: 6 }).map((_, i) => (
                                <span key={i} className={`h-4 rounded ${i === 4 ? cell : 'bg-slate-100'}`} />
                              ))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Recursos ─── */}
      <section id="recursos" className="max-w-6xl mx-auto px-5 py-16 md:py-24 scroll-mt-20">
        <div className="max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-black tracking-tight text-slate-900">
            Tudo o que a gestão precisa, sem complicação
          </h2>
          <p className="mt-4 text-lg text-slate-500">
            Cada etapa do mês — do lançamento à emissão e à aprovação — em um fluxo claro e auditável.
          </p>
        </div>

        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {RECURSOS.map(({ icon: Icon, titulo, desc, tint }) => (
            <div
              key={titulo}
              className="glass-card rounded-2xl p-6 hover:-translate-y-0.5 transition-transform"
            >
              <span className={`inline-flex w-11 h-11 rounded-xl items-center justify-center ring-1 ${TINTS[tint]}`}>
                <Icon className="w-5 h-5" />
              </span>
              <h3 className="mt-4 text-base font-black text-slate-900">{titulo}</h3>
              <p className="mt-2 text-sm text-slate-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Como funciona ─── */}
      <section id="como-funciona" className="bg-white border-y border-slate-200 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-5 py-16 md:py-24">
          <div className="max-w-2xl">
            <h2 className="text-3xl md:text-4xl font-black tracking-tight text-slate-900">
              Como funciona
            </h2>
            <p className="mt-4 text-lg text-slate-500">
              Quatro passos do começo ao fim do ciclo mensal.
            </p>
          </div>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {PASSOS.map((p, i) => (
              <div key={p.n} className="relative rounded-2xl border border-slate-200 p-6 bg-slate-50">
                <span className="inline-flex w-9 h-9 rounded-xl bg-violet-600 text-white items-center justify-center font-black">
                  {p.n}
                </span>
                <h3 className="mt-4 text-base font-black text-slate-900">{p.titulo}</h3>
                <p className="mt-2 text-sm text-slate-500 leading-relaxed">{p.desc}</p>
                {i < PASSOS.length - 1 && (
                  <ArrowRight className="hidden lg:block absolute top-1/2 -right-3 -translate-y-1/2 w-5 h-5 text-slate-300" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA final ─── */}
      <section className="max-w-6xl mx-auto px-5 py-16 md:py-24">
        <div className="relative overflow-hidden rounded-3xl bg-violet-600 px-8 py-14 md:px-16 md:py-20 text-center">
          <div className="pointer-events-none absolute -top-16 -right-10 w-72 h-72 bg-white/10 rounded-full blur-3xl" />
          <h2 className="relative text-3xl md:text-4xl font-black tracking-tight text-white">
            Pronto para organizar a gestão do seu condomínio?
          </h2>
          <p className="relative mt-4 text-lg text-violet-100 max-w-xl mx-auto">
            Acesse a plataforma e centralize arrecadações, emissões e aprovações em um só lugar.
          </p>
          <Link
            href="/login"
            className="relative mt-8 inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl bg-white text-violet-700 font-black hover:bg-violet-50 transition-colors shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-violet-600"
          >
            Entrar agora <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-slate-200">
        <div className="max-w-6xl mx-auto px-5 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <Logo />
          <p className="text-xs text-slate-400 font-bold">
            © {new Date().getFullYear()} CondoFlow · Sistema de Gestão de Condomínios
          </p>
          <Link href="/login" className="text-sm font-bold text-violet-600 hover:text-violet-700">
            Entrar →
          </Link>
        </div>
      </footer>
    </div>
  );
}
