import Link from 'next/link';
import { Fredoka } from 'next/font/google';
import { PenguinMark, PenguinGlyph } from '@/components/PenguinLogo';
import {
  Receipt, FileUp, FileCheck2, Droplet, ScanLine, ShieldCheck,
  ArrowRight, Check, Layers, Clock, ChevronDown, Building2,
} from 'lucide-react';

const fredoka = Fredoka({ subsets: ['latin'], weight: ['500', '600', '700'], display: 'swap' });

export const metadata = {
  title: 'CondoFlow — Gestão de Condomínios em um só lugar',
  description:
    'Arrecadações, cobranças, emissões com aprovação multinível, leitura automática de faturas e auditoria. A plataforma completa para administradoras e síndicos.',
};

const RECURSOS = [
  { icon: Receipt, tint: 'navy', titulo: 'Arrecadações & Rateios', desc: 'Planilha anual por condomínio, rateios e cobranças extras em poucos cliques — com histórico e bloqueio por mês.' },
  { icon: FileUp, tint: 'sky', titulo: 'Central de Emissões', desc: 'Monte o pacote de cada condomínio com boletos, faturas e relatórios — tudo organizado por mês.' },
  { icon: ScanLine, tint: 'orange', titulo: 'Leitura automática de PDF', desc: 'Faturas da SABESP, COMGÁS e ENEL lidas sozinhas: cliente, vencimento, valor e leitura por unidade na hora.' },
  { icon: FileCheck2, tint: 'navy', titulo: 'Aprovação multinível', desc: 'Fluxo de gerente → supervisores com auditoria, assinatura digital e solicitação de correção quando precisa.' },
  { icon: Droplet, tint: 'sky', titulo: 'Consumos sob controle', desc: 'Matriz mensal de água, gás e energia por condomínio, com variação, alerta de anomalia e detecção de duplicata.' },
  { icon: ShieldCheck, tint: 'orange', titulo: 'Acessos & Auditoria', desc: 'Cada perfil vê só o que deve. Toda ação fica registrada para a prestação de contas.' },
];

const PARA_QUEM = ['Administradoras', 'Síndicos', 'Gerentes de carteira', 'Equipes de cobrança', 'Contabilidade'];

const BENEFICIOS = [
  { icon: Layers, tint: 'navy', titulo: 'Menos planilha solta', desc: 'Arrecadações, cobranças, emissões e consumos num lugar só — todo mundo sobre a mesma informação, sempre atualizada.' },
  { icon: Clock, tint: 'orange', titulo: 'Menos retrabalho e erro', desc: 'Leitura automática das faturas e validações que barram duplicata e conta de outro condomínio antes da emissão.' },
  { icon: ShieldCheck, tint: 'sky', titulo: 'Prestação de contas pronta', desc: 'Aprovação multinível com assinatura e trilha de auditoria. Tudo organizado por mês e por condomínio.' },
];

const FAQ = [
  { q: 'Preciso instalar alguma coisa?', a: 'Não. O CondoFlow roda no navegador, em qualquer computador ou celular. Basta acessar o site e entrar.' },
  { q: 'Como funciona a leitura automática das faturas?', a: 'Ao anexar o PDF da concessionária (SABESP, COMGÁS, ENEL), o sistema extrai cliente, vencimento, valor e a leitura por unidade automaticamente — e ainda avisa se a conta está duplicada ou pertence a outro condomínio.' },
  { q: 'Cada pessoa enxerga tudo?', a: 'Não. O acesso é por perfil (síndico, gerente, supervisor, master): cada um vê e faz apenas o que lhe cabe, e toda ação fica registrada para auditoria.' },
  { q: 'Dá para controlar água, gás e energia?', a: 'Sim. Há uma matriz mensal de consumos por condomínio, com variação e alerta de anomalia, alimentada pelas faturas e relatórios anexados nas emissões.' },
  { q: 'Como começo a usar?', a: 'Clique em “Entrar” e acesse com as credenciais da sua administradora. A partir daí, o fluxo do mês já fica disponível.' },
];

const PASSOS = [
  { n: '1', titulo: 'Lance arrecadações', desc: 'O gerente registra a planilha do mês e as cobranças extras do condomínio.' },
  { n: '2', titulo: 'Monte a emissão', desc: 'O emissor anexa faturas e relatórios — lidos sozinhos — e vê a referência do gerente.' },
  { n: '3', titulo: 'Aprove com segurança', desc: 'O pacote passa pela aprovação multinível com assinatura e trilha de auditoria.' },
  { n: '4', titulo: 'Registre e acompanhe', desc: 'Emissão registrada, consumos atualizados e indicadores no painel central.' },
];

const TINTS = {
  navy:   { soft: 'bg-[#eef3fb]', icon: 'bg-[#1e3a8a] text-white', br: 'border-[#1e3a8a]/15' },
  sky:    { soft: 'bg-[#eaf1ff]', icon: 'bg-[#3b6fe0] text-white', br: 'border-[#3b6fe0]/15' },
  orange: { soft: 'bg-[#fff2e8]', icon: 'bg-[#f6883c] text-white', br: 'border-[#f6883c]/20' },
};

// Botão "pushable" estilo Duolingo (sombra-base que afunda no clique)
function PushLink({ href, children, color = 'navy', className = '' }) {
  const c = {
    navy:   'bg-[#1e3a8a] text-white shadow-[0_5px_0_#16306b] active:shadow-[0_0_0_#16306b]',
    orange: 'bg-[#f6883c] text-white shadow-[0_5px_0_#cf6a25] active:shadow-[0_0_0_#cf6a25]',
    white:  'bg-white text-[#1e3a8a] shadow-[0_5px_0_#d4ddef] active:shadow-[0_0_0_#d4ddef]',
  }[color];
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 px-7 py-4 rounded-2xl font-bold text-base uppercase tracking-wide transition-all hover:brightness-[1.05] active:translate-y-[5px] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#1e3a8a]/30 ${c} ${className} ${fredoka.className}`}
    >
      {children}
    </Link>
  );
}

function Wordmark({ className = '' }) {
  return (
    <span className={`text-xl font-bold tracking-tight text-[#1e3a8a] ${fredoka.className} ${className}`}>
      Condo<span className="text-[#f6883c]">Flow</span>
    </span>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-[#fdfaf4] text-slate-700">
      {/* ─── Nav ─── */}
      <header className="sticky top-0 z-40 border-b-2 border-[#1e3a8a]/10 bg-[#fdfaf4]/85 backdrop-blur-md">
        <nav className="max-w-6xl mx-auto px-5 h-[68px] flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5" aria-label="CondoFlow — início">
            <PenguinMark size={38} className="shrink-0" />
            <Wordmark />
          </Link>
          <div className="flex items-center gap-1 sm:gap-3">
            <a href="#recursos" className={`hidden sm:inline-flex text-sm font-semibold text-slate-500 hover:text-[#1e3a8a] px-3 py-2 rounded-xl transition-colors ${fredoka.className}`}>Recursos</a>
            <a href="#como-funciona" className={`hidden sm:inline-flex text-sm font-semibold text-slate-500 hover:text-[#1e3a8a] px-3 py-2 rounded-xl transition-colors ${fredoka.className}`}>Como funciona</a>
            <PushLink href="/login" className="!px-5 !py-2.5 !text-sm">Entrar</PushLink>
          </div>
        </nav>
      </header>

      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-32 -left-24 w-[460px] h-[460px] bg-[#3b6fe0]/10 rounded-full blur-[120px]" />
        <div className="pointer-events-none absolute top-10 right-[-8%] w-[420px] h-[420px] bg-[#f6883c]/10 rounded-full blur-[120px]" />

        <div className="relative max-w-6xl mx-auto px-5 pt-12 pb-12 md:pt-20 md:pb-20 grid lg:grid-cols-2 gap-10 items-center">
          {/* Texto */}
          <div className="animate-fade-up text-center lg:text-left">
            <span className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white border-2 border-[#1e3a8a]/10 text-[#1e3a8a] text-xs font-bold uppercase tracking-widest ${fredoka.className}`}>
              <Building2 className="w-3.5 h-3.5" /> Gestão de condomínios
            </span>
            <h1 className={`mt-5 text-4xl md:text-5xl lg:text-[3.7rem] font-bold tracking-tight text-[#102347] leading-[1.06] ${fredoka.className}`}>
              Cuidar do condomínio<br className="hidden md:block" /> ficou <span className="text-[#f6883c]">leve</span>.
            </h1>
            <p className="mt-5 text-lg text-slate-500 leading-relaxed max-w-xl mx-auto lg:mx-0">
              Arrecadações, cobranças, emissões com aprovação multinível e leitura automática de faturas.
              Menos planilha solta, mais controle — do lançamento à prestação de contas.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <PushLink href="/login" color="orange">Acessar o sistema <ArrowRight className="w-4 h-4" /></PushLink>
              <PushLink href="#recursos" color="white">Ver recursos</PushLink>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-slate-500 justify-center lg:justify-start">
              {['Leitura automática de faturas', 'Aprovação multinível', 'Auditoria completa'].map(t => (
                <li key={t} className="inline-flex items-center gap-1.5">
                  <span className="inline-flex w-5 h-5 rounded-full bg-[#e9f7ee] text-[#1d9e75] items-center justify-center"><Check className="w-3 h-3" strokeWidth={3} /></span>{t}
                </li>
              ))}
            </ul>
          </div>

          {/* Mascote */}
          <div className="relative flex justify-center lg:justify-end">
            <div className="relative">
              {/* blob */}
              <div className="w-[300px] h-[300px] sm:w-[360px] sm:h-[360px] rounded-[42%_58%_55%_45%/48%_42%_58%_52%] bg-[#eaf1ff] border-2 border-[#3b6fe0]/15" />
              {/* pinguim */}
              <div className="absolute inset-0 flex items-center justify-center animate-float">
                <PenguinGlyph size={230} />
              </div>
              {/* balão de fala */}
              <div className={`absolute -top-2 -right-2 sm:right-0 bg-white border-2 border-[#1e3a8a]/10 rounded-2xl rounded-br-sm px-4 py-2.5 shadow-[0_4px_0_#e7ddcb] ${fredoka.className}`}>
                <p className="text-sm font-semibold text-[#1e3a8a]">Bora deixar o<br />condomínio em ordem!</p>
              </div>
              {/* chips flutuantes */}
              <div className="absolute -left-3 sm:-left-8 top-1/3 bg-white border-2 border-[#f6883c]/20 rounded-2xl px-3 py-2 shadow-[0_4px_0_#f3e2d2] flex items-center gap-2 animate-float" style={{ animationDelay: '600ms' }}>
                <span className="inline-flex w-7 h-7 rounded-lg bg-[#fff2e8] text-[#f6883c] items-center justify-center"><ScanLine className="w-4 h-4" /></span>
                <span className={`text-xs font-bold text-[#102347] ${fredoka.className}`}>Fatura lida</span>
              </div>
              <div className="absolute -right-2 sm:-right-6 bottom-8 bg-white border-2 border-[#1d9e75]/20 rounded-2xl px-3 py-2 shadow-[0_4px_0_#d7ecdf] flex items-center gap-2 animate-float" style={{ animationDelay: '300ms' }}>
                <span className="inline-flex w-7 h-7 rounded-lg bg-[#e9f7ee] text-[#1d9e75] items-center justify-center"><FileCheck2 className="w-4 h-4" /></span>
                <span className={`text-xs font-bold text-[#102347] ${fredoka.className}`}>Aprovado</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Para quem é ─── */}
      <section className="border-y-2 border-[#1e3a8a]/10 bg-white">
        <div className="max-w-6xl mx-auto px-5 py-8">
          <p className={`text-center text-xs font-bold uppercase tracking-widest text-slate-400 ${fredoka.className}`}>Feito para quem cuida de condomínios</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            {PARA_QUEM.map(t => (
              <span key={t} className={`inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#fdfaf4] border-2 border-[#1e3a8a]/10 text-sm font-semibold text-slate-600 ${fredoka.className}`}>
                <Check className="w-3.5 h-3.5 text-[#f6883c]" strokeWidth={3} /> {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Benefícios ─── */}
      <section className="max-w-6xl mx-auto px-5 py-16 md:py-24">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className={`text-3xl md:text-4xl font-bold tracking-tight text-[#102347] ${fredoka.className}`}>Por que o CondoFlow</h2>
          <p className="mt-4 text-lg text-slate-500">Não é mais uma planilha — é o ciclo do mês organizado de ponta a ponta.</p>
        </div>
        <div className="mt-12 grid md:grid-cols-3 gap-6">
          {BENEFICIOS.map(({ icon: Icon, titulo, desc, tint }) => (
            <div key={titulo} className={`rounded-3xl bg-white border-2 border-b-[6px] ${TINTS[tint].br} p-7 transition-transform hover:-translate-y-1`}>
              <span className={`inline-flex w-14 h-14 rounded-2xl items-center justify-center ${TINTS[tint].icon}`}><Icon className="w-7 h-7" /></span>
              <h3 className={`mt-5 text-lg font-bold text-[#102347] ${fredoka.className}`}>{titulo}</h3>
              <p className="mt-2 text-sm text-slate-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Recursos ─── */}
      <section id="recursos" className="bg-white border-y-2 border-[#1e3a8a]/10 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-5 py-16 md:py-24">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className={`text-3xl md:text-4xl font-bold tracking-tight text-[#102347] ${fredoka.className}`}>Tudo o que a gestão precisa</h2>
            <p className="mt-4 text-lg text-slate-500">Cada etapa do mês — do lançamento à emissão e à aprovação — num fluxo claro e auditável.</p>
          </div>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {RECURSOS.map(({ icon: Icon, titulo, desc, tint }) => (
              <div key={titulo} className={`rounded-3xl ${TINTS[tint].soft} border-2 border-b-[6px] ${TINTS[tint].br} p-6 transition-transform hover:-translate-y-1`}>
                <span className={`inline-flex w-12 h-12 rounded-2xl items-center justify-center ${TINTS[tint].icon}`}><Icon className="w-6 h-6" /></span>
                <h3 className={`mt-4 text-base font-bold text-[#102347] ${fredoka.className}`}>{titulo}</h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Como funciona ─── */}
      <section id="como-funciona" className="max-w-6xl mx-auto px-5 py-16 md:py-24 scroll-mt-20">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className={`text-3xl md:text-4xl font-bold tracking-tight text-[#102347] ${fredoka.className}`}>Como funciona</h2>
          <p className="mt-4 text-lg text-slate-500">Quatro passos do começo ao fim do ciclo mensal.</p>
        </div>
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {PASSOS.map((p, i) => (
            <div key={p.n} className="relative rounded-3xl bg-white border-2 border-b-[6px] border-[#1e3a8a]/12 p-6">
              <span className={`inline-flex w-11 h-11 rounded-2xl bg-[#1e3a8a] text-white items-center justify-center text-lg font-bold ${fredoka.className}`}>{p.n}</span>
              <h3 className={`mt-4 text-base font-bold text-[#102347] ${fredoka.className}`}>{p.titulo}</h3>
              <p className="mt-2 text-sm text-slate-500 leading-relaxed">{p.desc}</p>
              {i < PASSOS.length - 1 && <ArrowRight className="hidden lg:block absolute top-8 -right-3.5 w-6 h-6 text-[#f6883c]" strokeWidth={2.5} />}
            </div>
          ))}
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section id="faq" className="bg-white border-y-2 border-[#1e3a8a]/10 scroll-mt-20">
        <div className="max-w-3xl mx-auto px-5 py-16 md:py-24">
          <h2 className={`text-3xl md:text-4xl font-bold tracking-tight text-[#102347] text-center ${fredoka.className}`}>Perguntas frequentes</h2>
          <div className="mt-10 space-y-3">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="group rounded-2xl bg-[#fdfaf4] border-2 border-[#1e3a8a]/10 p-5 open:border-[#1e3a8a]/20">
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none">
                  <span className={`text-base font-semibold text-[#102347] ${fredoka.className}`}>{q}</span>
                  <ChevronDown className="w-5 h-5 text-[#f6883c] shrink-0 transition-transform group-open:rotate-180" strokeWidth={2.5} />
                </summary>
                <p className="mt-3 text-sm text-slate-500 leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA final ─── */}
      <section className="max-w-6xl mx-auto px-5 py-16 md:py-24">
        <div className="relative overflow-hidden rounded-[2.5rem] bg-[#1e3a8a] px-8 py-14 md:px-16 md:py-16">
          <div className="pointer-events-none absolute -top-16 -right-10 w-72 h-72 bg-[#f6883c]/20 rounded-full blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-10 w-72 h-72 bg-[#3b6fe0]/30 rounded-full blur-3xl" />
          <div className="relative flex flex-col md:flex-row items-center gap-8 md:gap-12">
            <div className="shrink-0 w-36 h-36 rounded-[42%_58%_55%_45%/48%_42%_58%_52%] bg-white/10 flex items-center justify-center animate-float">
              <PenguinGlyph size={120} />
            </div>
            <div className="text-center md:text-left">
              <h2 className={`text-3xl md:text-4xl font-bold tracking-tight text-white ${fredoka.className}`}>Pronto para organizar o seu condomínio?</h2>
              <p className="mt-4 text-lg text-[#c7d6f5] max-w-xl">Centralize arrecadações, emissões e aprovações em um só lugar — com o porteiro digital de olho em tudo.</p>
              <div className="mt-7 flex justify-center md:justify-start">
                <PushLink href="/login" color="orange">Entrar agora <ArrowRight className="w-4 h-4" /></PushLink>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t-2 border-[#1e3a8a]/10 bg-white">
        <div className="max-w-6xl mx-auto px-5 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5"><PenguinMark size={32} /><Wordmark className="!text-lg" /></Link>
          <p className="text-xs text-slate-400 font-semibold">© {new Date().getFullYear()} CondoFlow · Sistema de Gestão de Condomínios</p>
          <Link href="/login" className={`text-sm font-bold text-[#1e3a8a] hover:text-[#f6883c] transition-colors ${fredoka.className}`}>Entrar →</Link>
        </div>
      </footer>
    </div>
  );
}
