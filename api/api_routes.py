import os
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File # type: ignore
from supabase import Client # type: ignore
from pydantic import BaseModel # type: ignore
from auth_constants import (
    APPROVE_DOCUMENT, EMIT_DOCUMENT, EDIT_COBRANCAS_EXTRAS,
    DASHBOARD_FILTER_GERENTE, VIEW_AUDITORIA,
)
# A base (conexao, login, recorte de carteira) e o envio de e-mail sairam para
# modulos proprios: sao usados por mais de um arquivo de rotas, e sem isso a
# primeira separacao ja criaria import circular.
from deps import (
    get_db, get_current_user, get_gerente_id,
    carteira_gerente_id, carteira_condo_ids,
    SB_SERVICE, _user_cache,
)
from emails import _enviar_email_smtp, _enviar_email_acesso, _enviar_email_recuperacao

router = APIRouter()

# ═══ API ENDPOINTS ═══════════════════════════════════════════════════

@router.get("/health")
def api_health():
    # Endpoint leve (sem auth, sem DB) só para "acordar" a função e tirar o cold start.
    return {"ok": True}

# As mesmas listas de frontend/src/lib/statusEmissao.js. Um status escrito de
# tres jeitos ao longo do tempo continua sendo o mesmo status, e contar so a
# grafia nova faz o numero mentir para baixo — calado.
EM_CORRECAO_SQL = ["solicitar_correcao", "Solicitar alteração", "Solicitar correção"]
COM_SUP_GERENTES_SQL = ["pendente_sup_gerentes", "Aguardando Chefe"]
COM_SUP_CONTAB_SQL = ["pendente_sup_contabilidade", "Aguardando Supervisor"]


@router.get("/dashboard")
def api_dashboard(gerente_id: Optional[str] = None, mes: Optional[int] = None, ano: Optional[int] = None, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        from datetime import datetime
        year = datetime.now().year
        sem = 1 if datetime.now().month <= 6 else 2
        emis_ano = int(ano) if ano else year

        # O join de processos vinha SEM filtro: trazia todo processo de todo
        # condomínio, de todos os semestres desde 2024, e o laço abaixo jogava
        # fora tudo que não fosse do semestre corrente. Com 325 condomínios e
        # vários semestres, é a consulta mais cara do sistema — e roda a cada
        # abertura do painel.
        #
        # Filtrar o recurso embutido (`processos.year`) recorta ANTES de vir
        # pela rede. Sem `!inner`, condomínio sem processo do semestre continua
        # aparecendo, com a lista vazia — que é o que o laço já espera.
        # So os condominios EM OPERACAO.
        #
        # Sao 325 cadastrados e 66 que emitem: os outros 259 ja existem, mas
        # ainda vao entrar. Tratados como iguais, o painel dizia "325
        # condominios", o filtro "sem emissao" listava 259 que ninguem deveria
        # estar cobrando, e as contagens da fila mediam uma base que nao existe.
        #
        # Quem vai entrar nao some do sistema: vem contado a parte
        # (`a_entrar`), e a tela oferece o filtro para ve-los.
        query = (db.table("condominios").select("*, processos(*)")
                   .eq("processos.year", year)
                   .eq("processos.semester", sem)
                   .eq("situacao", "ativo"))

        # Filtros baseados na role
        if user["role"] in ("gerente", "assistente"):
            g_id = carteira_gerente_id(db, user)
            query = query.eq("gerente_id", g_id or "00000000-0000-0000-0000-000000000000")
        elif gerente_id and user["role"] in DASHBOARD_FILTER_GERENTE:
            query = query.eq("gerente_id", gerente_id)

        # As 3 consultas independentes rodam EM PARALELO (supabase-py é síncrono;
        # antes eram idas sequenciais ao banco). Os pacotes vêm depois (dependem
        # dos ids dos condomínios).
        from concurrent.futures import ThreadPoolExecutor
        def _q_condos():
            return query.execute().data or []
        def _q_gerentes():
            if user["role"] == "gerente":
                return []
            try:
                return db.table("gerentes").select("id, nome, profiles!gerentes_profile_id_fkey(full_name)").execute().data
            except Exception as e:
                print(f"[dashboard] gerentes falhou (segue sem): {e}")
                return []
        def _q_pipeline():
            try:
                return (db.table("pipeline_config").select("*").eq("ano", year).limit(1).execute().data or [None])[0]
            except Exception as e:
                print(f"[dashboard] pipeline_config falhou (segue sem): {e}")
                return None
        def _q_a_entrar_total():
            """Quantos esperam entrar — so o numero.

            A lista inteira vinha na resposta para alimentar uma aba que nao
            existe mais. O numero fica: 259 condominios parados sao uma boa
            pergunta para o master fazer todo mes, e cabe em quatro bytes.
            """
            try:
                q = db.table("condominios").select("id", count="exact").eq("situacao", "a_entrar").limit(1)
                if user.get("role") in ("gerente", "assistente"):
                    g_id = carteira_gerente_id(db, user)
                    if not g_id:
                        return 0
                    q = q.eq("gerente_id", g_id)
                return q.execute().count or 0
            except Exception as e:
                print(f"[dashboard] a_entrar_total falhou (segue sem): {e}")
                return 0

        def _q_edicoes():
            # As edicoes do ano vinham numa SEGUNDA chamada do navegador
            # (/api/edicoes-mensais), sempre junto com esta. Duas viagens para
            # pintar a mesma tela — e cada viagem paga o pedagio inteiro de ida
            # e volta, que na instancia atual do Supabase e de 250-500 ms.
            #
            # Aqui ela roda EM PARALELO com as outras tres: nao custa tempo
            # nenhum a mais na resposta, e apaga uma chamada da rede.
            try:
                q = db.table("edicoes_mensais") \
                      .select("*, condominios(name), gerentes(id, nome, profiles!gerentes_profile_id_fkey(full_name))") \
                      .eq("ano_referencia", emis_ano)
                # Mesmo recorte de carteira do resto do painel: gerente e
                # assistente so enxergam a propria fila.
                if user.get("role") in ("gerente", "assistente"):
                    g_id = carteira_gerente_id(db, user)
                    if not g_id:
                        return []
                    q = q.eq("gerente_id", g_id)
                return q.order("mes_referencia", desc=True).execute().data or []
            except Exception as e:
                print(f"[dashboard] edicoes_mensais falhou (segue sem): {e}")
                return []
        # ── O que o NAVEGADOR buscava sozinho ──────────────────────────────
        #
        # A Fila de Conferencia, o sino e as etiquetas de consumo faziam 15
        # consultas diretas ao Supabase para pintar a mesma tela que esta
        # resposta ja pinta. Cada uma pagava o pedagio de ida e volta (250-500
        # ms na instancia atual, medido) do navegador do usuario, que fica mais
        # longe do banco do que este servidor.
        #
        # Tudo vem junto aqui, em paralelo. O que a tela faz com os numeros
        # continua sendo decidido la: o backend manda contagem, nao texto de
        # tela — assim mudar a frase de um card nao exige tocar na API.
        def _q_ocorrencias():
            try:
                q = db.table("emissoes_ocorrencias").select("*, condominios(name)")
                if user.get("role") in ("gerente", "assistente"):
                    ids = carteira_condo_ids(db, user)
                    if not ids:
                        return []
                    q = q.in_("condominio_id", ids)
                return q.order("criado_em", desc=True).limit(200).execute().data or []
            except Exception as e:
                print(f"[dashboard] ocorrencias falhou (segue sem): {e}")
                return []

        def _q_concessionarias():
            try:
                rows = db.table("condominios_concessionarias") \
                         .select("condominio_id, concessionaria").execute().data or []
                m = {}
                for r in rows:
                    m.setdefault(r["condominio_id"], []).append(r.get("concessionaria"))
                return m
            except Exception as e:
                print(f"[dashboard] concessionarias falhou (segue sem): {e}")
                return {}

        def _q_notificacoes():
            try:
                return db.table("notificacoes").select("*") \
                         .eq("user_id", user["id"]) \
                         .order("created_at", desc=True).limit(30).execute().data or []
            except Exception as e:
                print(f"[dashboard] notificacoes falhou (segue sem): {e}")
                return []

        def _q_fila():
            """Contagens da Fila de Conferencia, por papel.

            Cada `count='exact', head=True` volta so o numero, sem linha
            nenhuma — e as cinco saem na mesma rodada de threads das outras.
            """
            papel = user.get("role")
            out = {}
            try:
                def conta(tabela, aplica):
                    q = db.table(tabela).select("id", count="exact").limit(1)
                    return (aplica(q).execute().count or 0)

                if papel in ("master", "departamento"):
                    out["reaberturas_pendentes"] = conta(
                        "edicoes_mensais", lambda q: q.eq("status", "reabertura_solicitada"))
                    out["pacotes_aprovado"] = conta(
                        "emissoes_pacotes", lambda q: q.eq("status", "aprovado"))
                    out["faturas_sem_dados"] = conta(
                        "emissoes_arquivos",
                        lambda q: q.eq("categoria", "concessionaria").is_("valor_fatura", "null"))
                    out["pacotes_correcao"] = conta(
                        "emissoes_pacotes", lambda q: q.in_("status", EM_CORRECAO_SQL))
                    out["ocorrencias_abertas"] = conta(
                        "emissoes_ocorrencias", lambda q: q.eq("status", "aberta"))

                    # Atalhos: para qual mes o painel deve abrir.
                    for chave, filtro in (("alvo_aprovado", ["aprovado"]),
                                          ("alvo_correcao", EM_CORRECAO_SQL)):
                        r = db.table("emissoes_pacotes") \
                              .select("mes_referencia, ano_referencia") \
                              .in_("status", filtro) \
                              .order("atualizado_em", desc=True).limit(1).execute().data
                        out[chave] = r[0] if r else None

                    r = db.table("emissoes_arquivos") \
                          .select("pacote_id, emissoes_pacotes(condominio_id, mes_referencia, ano_referencia)") \
                          .eq("categoria", "concessionaria").is_("valor_fatura", "null") \
                          .order("criado_em", desc=True).limit(1).execute().data
                    out["fatura_falha"] = r[0] if r else None

                if papel in ("gerente", "assistente"):
                    g_id = carteira_gerente_id(db, user)
                    if g_id:
                        out["edicoes_em_edicao"] = conta(
                            "edicoes_mensais",
                            lambda q: q.eq("gerente_id", g_id).eq("status", "em_edicao"))
                        from datetime import datetime as _d, timedelta as _t
                        sete = (_d.now() - _t(days=7)).isoformat()
                        reabs = db.table("edicoes_mensais") \
                                  .select("reabertura_aprovada") \
                                  .eq("gerente_id", g_id) \
                                  .not_.is_("reabertura_respondida_em", "null") \
                                  .gte("reabertura_respondida_em", sete).execute().data or []
                        out["reaberturas_aprovadas"] = sum(1 for r in reabs if r.get("reabertura_aprovada") is True)
                        out["reaberturas_negadas"] = sum(1 for r in reabs if r.get("reabertura_aprovada") is False)

                if papel in ("supervisora", "supervisor_gerentes"):
                    out["pacotes_sup_gerentes"] = conta(
                        "emissoes_pacotes",
                        lambda q: q.in_("status", COM_SUP_GERENTES_SQL))
                if papel in ("supervisora", "supervisora_contabilidade"):
                    out["pacotes_sup_contabilidade"] = conta(
                        "emissoes_pacotes",
                        lambda q: q.in_("status", COM_SUP_CONTAB_SQL))
            except Exception as e:
                print(f"[dashboard] fila falhou (segue sem): {e}")
            return out

        with ThreadPoolExecutor(max_workers=8) as _ex:
            _fc, _fg, _fp = _ex.submit(_q_condos), _ex.submit(_q_gerentes), _ex.submit(_q_pipeline)
            _fe = _ex.submit(_q_edicoes)
            _fo, _fk, _fn, _ff = (_ex.submit(_q_ocorrencias), _ex.submit(_q_concessionarias),
                                  _ex.submit(_q_notificacoes), _ex.submit(_q_fila))
            _fat = _ex.submit(_q_a_entrar_total)
            raw_condos = _fc.result()
            gerentes = _fg.result()
            edicoes_ano = _fe.result()
            ocorrencias = _fo.result()
            concessionarias = _fk.result()
            notificacoes = _fn.result()
            fila_contagens = _ff.result()
            a_entrar_total = _fat.result()
            pipeline_config = _fp.result()

        condos = []
        processos = {}
        stats = {"total": len(raw_condos), "em_edicao": 0, "pendentes": 0, "aprovados": 0}

        for c in raw_condos:
            procs = c.pop("processos", [])
            proc = next((p for p in procs if p["year"] == year and p["semester"] == sem), None)
            if proc:
                processos[c["id"]] = proc
                st = proc["status"]
                if st in ["Em edição", "Solicitar alteração"]: stats["em_edicao"] += 1
                elif st in ["Enviado", "Em aprovação"]: stats["pendentes"] += 1
                elif st in ["Aprovado", "Emitido"]: stats["aprovados"] += 1
            else:
                stats["em_edicao"] += 1

            condos.append(c)
            
        # (gerentes já carregado em paralelo acima)

        # ── Emissões: stats agregados + status mais recente por condomínio ──
        condo_ids = [c["id"] for c in raw_condos]
        emissao_stats = {"gerente": 0, "supGerente": 0, "supContabilidade": 0, "aguardando": 0, "registrada": 0}
        emissao_by_condo = {}
        # Quantas emissoes canceladas o condominio tem no mes.
        #
        # Separado de `emissao_by_condo` de proposito: aquele guarda UM status,
        # e a cancelada perde a vaga para a emissao que a substituiu — que e o
        # certo, mas faz a cancelada sumir do painel exatamente onde a pessoa
        # decide o que fazer no mes. Este contador sobrevive a substituicao.
        canceladas_by_condo = {}
        if condo_ids:
            pacotes_q = db.table("emissoes_pacotes").select("status, condominio_id, criado_em, mes_referencia, ano_referencia") \
                .in_("condominio_id", condo_ids) \
                .order("criado_em", desc=True)
            # Filtra a emissão pelo mês selecionado (status daquele mês, não o último de todos)
            if mes:
                pacotes_q = pacotes_q.eq("mes_referencia", int(mes)).eq("ano_referencia", emis_ano)
            try:
                pacotes = pacotes_q.execute().data or []
            except Exception as e:
                print(f"[dashboard] emissoes_pacotes falhou (segue sem): {e}")
                pacotes = []
            # Comparacao por LISTA, nao por pedaco de texto.
            #
            # Era `"supervisor" in s` e `"sup. gerentes" in s` — e as grafias
            # reais sao `pendente_sup_contabilidade` e `pendente_sup_gerentes`,
            # com underline. Nenhuma casava, entao Sup. Contabilidade contava
            # ZERO. Pior: `pendente_sup_gerentes` CONTEM "gerente", entao esses
            # pacotes iam para a conta do gerente — numero errado, nao faltando.
            #
            # Mesmo defeito que estava no frontend (VisaoMaster, usePendingCount),
            # repetido aqui no servidor.
            COM_GERENTE = {"pendente_gerente", "aguardando gerente", "pendente"}
            COM_SPG     = {"pendente_sup_gerentes", "aguardando chefe"}
            COM_SPC     = {"pendente_sup_contabilidade", "aguardando supervisor"}

            for p in pacotes:
                s = (p.get("status") or "").lower().strip()
                if s in COM_GERENTE: emissao_stats["gerente"] += 1
                elif s in COM_SPG:   emissao_stats["supGerente"] += 1
                elif s in COM_SPC:   emissao_stats["supContabilidade"] += 1
                elif s == "aprovado": emissao_stats["aguardando"] += 1
                elif s == "registrado": emissao_stats["registrada"] += 1

                cid = p.get("condominio_id")
                if not cid:
                    continue
                # Cancelada nao representa o condominio no mes: existe uma nova
                # no lugar dela. So entra se for a unica que houver, e af o
                # painel mostra "cancelada" em vez de fingir que nao ha emissao.
                if s == "cancelada":
                    canceladas_by_condo[cid] = canceladas_by_condo.get(cid, 0) + 1
                    emissao_by_condo.setdefault(cid, "cancelada")
                elif emissao_by_condo.get(cid) in (None, "cancelada"):
                    emissao_by_condo[cid] = p.get("status") or "sem_processo"

        # (pipeline_config já carregado em paralelo acima)

        return {
            "year": year,
            "semester": sem,
            "stats": stats,
            "condos": condos,
            "processos": processos,
            "gerentes": gerentes,
            "emissao_stats": emissao_stats,
            "emissao_by_condo": emissao_by_condo,
            "canceladas_by_condo": canceladas_by_condo,
            # Junto na mesma resposta: era a segunda chamada do painel.
            "edicoes": edicoes_ano,
            # Junto tambem: eram 15 consultas diretas do navegador.
            "ocorrencias": ocorrencias,
            "concessionarias_por_condo": concessionarias,
            "notificacoes": notificacoes,
            "fila_contagens": fila_contagens,
            "a_entrar_total": a_entrar_total,
            "emissao_mes": int(mes) if mes else None,
            "emissao_ano": emis_ano,
            "pipeline_config": pipeline_config,
        }
    except Exception as e:
        print(f"ERROR /dashboard: {e}")
        raise HTTPException(500, str(e))


class ForgotPasswordSchema(BaseModel):
    email: str
    redirect_to: Optional[str] = None

@router.post("/auth/forgot-password")
def api_forgot_password(data: ForgotPasswordSchema, db: Client = Depends(get_db)):
    """'Esqueci minha senha' (público): gera o link de recuperação (Supabase admin) e envia
    pelo NOSSO Gmail — não depende do e-mail do Supabase. Resposta SEMPRE genérica
    (anti-enumeração de e-mails)."""
    email = (data.email or "").strip().lower()
    if not email:
        raise HTTPException(400, "Informe o e-mail.")
    if not SB_SERVICE:
        raise HTTPException(500, "Service Key não configurada")
    try:
        params = {"type": "recovery", "email": email}
        if data.redirect_to:
            params["options"] = {"redirect_to": data.redirect_to}
        res = db.auth.admin.generate_link(params)
        # extrai o action_link (varia conforme versão da lib)
        link = None
        props = getattr(res, "properties", None)
        if props is not None:
            link = getattr(props, "action_link", None)
            if not link and isinstance(props, dict):
                link = props.get("action_link")
        if not link and isinstance(res, dict):
            link = (res.get("properties") or {}).get("action_link")
        if link:
            nome = ""
            try:
                p = db.table("profiles").select("full_name").eq("email", email).maybe_single().execute().data
                nome = (p or {}).get("full_name") or ""
            except Exception:
                pass
            _enviar_email_recuperacao(db, email, nome, link)
    except Exception as e:
        # nunca vaza se o e-mail existe ou não
        print(f"[forgot-password] {email}: {e}")
    return {"ok": True}



# ═══ Acesso seguro a arquivos (via nosso backend; esconde o Supabase + trava por arquivo) ══
def _sign_arquivo_token(path: str, ttl: int = 120) -> str:
    import os, hmac, hashlib, base64, time
    exp = int(time.time()) + ttl
    payload = f"{path}|{exp}"
    sig = hmac.new(os.getenv("SECRET_KEY", "dev-key").encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    return base64.urlsafe_b64encode(f"{payload}|{sig}".encode()).decode().rstrip("=")

def _verify_arquivo_token(token: str):
    import os, hmac, hashlib, base64, time
    try:
        raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)).decode()
        path, exp, sig = raw.rsplit("|", 2)
        if int(exp) < int(time.time()):
            return None
        good = hmac.new(os.getenv("SECRET_KEY", "dev-key").encode(), f"{path}|{exp}".encode(), hashlib.sha256).hexdigest()[:32]
        return path if hmac.compare_digest(good, sig) else None
    except Exception:
        return None

def _arquivo_condo_id(db, path: str):
    """Resolve o condomínio dono do arquivo pelos registros do banco (p/ checar permissão)."""
    for tbl, col in [("emissoes_arquivos", "arquivo_url"), ("segundas_vias", "boleto_url"),
                     ("segundas_vias", "anexo_url"), ("consumos_faturas", "arquivo_url"),
                     ("consumos_relatorios_leitura", "arquivo_url"), ("emissoes", "storage_path")]:
        try:
            r = db.table(tbl).select("condominio_id").eq(col, path).limit(1).execute().data
            if r:
                return r[0].get("condominio_id")
        except Exception:
            pass
    return None

class ArquivoLinkSchema(BaseModel):
    path: str
    stream: Optional[bool] = False   # true = link same-origin (p/ quem faz fetch()/download no navegador, sem CORS)

@router.post("/arquivo/link")
def api_arquivo_link(data: ArquivoLinkSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Devolve um link curto para abrir o arquivo, só se o usuário tiver permissão.
    A permissão é checada AQUI; o arquivo é entregue por URL ASSINADA direto pela CDN
    do Supabase (não passa pela função serverless) — tira banda/memória do backend e
    escala p/ o volume de boletos. Se a assinatura falhar, cai no streaming interno."""
    path = (data.path or "").strip()
    if not path:
        raise HTTPException(400, "path obrigatório")
    if user["role"] not in ("master", "departamento"):
        cid = _arquivo_condo_id(db, path)
        if user["role"] in ("gerente", "assistente"):
            if not cid or cid not in carteira_condo_ids(db, user):
                raise HTTPException(403, "Sem permissão para este arquivo.")
        elif not cid:
            raise HTTPException(403, "Sem permissão para este arquivo.")
    # Preferência: URL assinada do Supabase (entrega direta pela CDN, sem passar pela função).
    # TTL curto (5 min): tempo de sobra p/ abrir/visualizar, exposição mínima se o link vazar.
    # stream=true pula isso: quem faz fetch()/download no navegador (extração, ZIP) precisa
    # de link same-origin p/ não depender de CORS cross-origin do Supabase.
    if not data.stream:
        try:
            signed = db.storage.from_("emissoes").create_signed_url(path, 300)   # 5 min
            url = signed.get("signedURL") if isinstance(signed, dict) else signed
            if url:
                return {"url": url, "direct": True}
        except Exception as e:
            print(f"[arquivo/link] URL assinada falhou, usando streaming interno: {e}")
    # Streaming same-origin protegido por token (compatível com o comportamento antigo)
    return {"url": f"/api/arquivo/abrir?t={_sign_arquivo_token(path)}", "direct": False}

@router.get("/arquivo/abrir")
def api_arquivo_abrir(t: str, db: Client = Depends(get_db)):
    """Streama o arquivo (protegido por token assinado, curto). Sem expor o Supabase."""
    from fastapi import Response
    path = _verify_arquivo_token(t)
    if not path:
        raise HTTPException(403, "Link inválido ou expirado.")
    try:
        conteudo = db.storage.from_("emissoes").download(path)
    except Exception:
        raise HTTPException(404, "Arquivo não encontrado.")
    nome = path.split("/")[-1] or "arquivo"
    low = nome.lower()
    mime = ("application/pdf" if low.endswith(".pdf")
            else "image/png" if low.endswith(".png")
            else "image/jpeg" if low.endswith((".jpg", ".jpeg"))
            else "image/webp" if low.endswith(".webp")
            else "application/octet-stream")
    return Response(content=conteudo, media_type=mime,
                    headers={"Content-Disposition": f'inline; filename="{nome}"', "Cache-Control": "private, no-store"})


class EmailHookSchema(BaseModel):
    to: str
    subject: str
    html: str

@router.post("/notificacoes/email-hook")
def api_email_hook(data: EmailHookSchema, request: Request):
    """Envia e-mail via SMTP (Gmail). Chamado pelo banco (pg_net) com o segredo no header.
    NÃO usa get_current_user — é protegido pelo header x-notif-secret."""
    import os
    secret = os.getenv("NOTIF_EMAIL_SECRET")
    if not secret or request.headers.get("x-notif-secret") != secret:
        raise HTTPException(401, "unauthorized")

    if not _enviar_email_smtp(data.to, data.subject, data.html):
        raise HTTPException(500, "falha no envio de e-mail")
    return {"ok": True}


# ═══ Extrair emissão: PDF único montado NO SERVIDOR ════════════════════════════════
# Por que no servidor: no navegador a mesclagem dependia de DECODIFICAR os scans
# (JBIG2 via WASM no pdf.js). Quando isso falhava, saía a página em branco. Aqui o
# pikepdf (QPDF) apenas COPIA as páginas — não decodifica nada — então o resultado é
# fiel e o visualizador do usuário renderiza igual ao arquivo original.

def _norm_txt(s):
    import unicodedata
    s = unicodedata.normalize("NFD", str(s or ""))
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower().strip()


def _ordenar_para_extracao(arquivos, cobrancas):
    """Ordem de auditoria (espelha ordenarParaExtracao do front):
    1 Emissão · 2 Correios · 3 Seguros · 4 Água · 5 Gás · 6 Energia ·
    7 Cobranças extras e salão · 8 Relatório de rateio · resto no fim."""
    usados, out = set(), []

    def add(item):
        chave = item.get("__attachment") or item.get("arquivo_url") or item.get("id")
        if not chave or chave in usados:
            return
        usados.add(chave)
        out.append(item)

    def por_cat(cat):
        return [a for a in arquivos if a.get("categoria") == cat]

    def outros_sub(*subs):
        alvo = [_norm_txt(s) for s in subs]
        return [a for a in arquivos if a.get("categoria") == "outros" and _norm_txt(a.get("subtipo")) in alvo]

    def concess(*chaves):
        alvo = [_norm_txt(k) for k in chaves]
        return [a for a in arquivos
                if a.get("categoria") == "concessionaria" and any(k in _norm_txt(a.get("subtipo")) for k in alvo)]

    def relat(serv):
        return [a for a in arquivos
                if a.get("categoria") == "relatorio_leitura" and _norm_txt(a.get("relatorio_tipo_servico")) == serv]

    for a in por_cat("emissao"):
        add(a)
    for a in outros_sub("Correios"):
        add(a)
    for a in outros_sub("Seguro", "Seguros"):
        add(a)
    for a in concess("sabesp", "agua"):
        add(a)
    for a in relat("agua"):
        add(a)
    for a in concess("comgas", "gas"):
        add(a)
    for a in relat("gas"):
        add(a)
    for a in concess("enel", "energia", "eletropaulo", "cpfl", "edp", "light"):
        add(a)
    for c in (cobrancas or []):
        for att in (c.get("attachments") or []):
            add({"__attachment": att, "arquivo_nome": f"Cobranca_{c.get('descricao') or c.get('description') or ''}"})
    for a in outros_sub("Salão de festas", "Salao de festas"):
        add(a)
    for a in outros_sub("Relatório de Rateio", "Relatorio de Rateio"):
        add(a)
    for a in arquivos:
        add(a)
    return out


def _cobrancas_da_emissao(db, pac):
    """Cobranças extras incluídas na emissão, com os anexos. Prioriza o snapshot
    congelado no registro; sem ele (emissões antigas) lê da tabela INCLUINDO as
    'processada' (o /conferencia esconde as processadas)."""
    snap = pac.get("cobrancas_snapshot")
    if isinstance(snap, list) and snap:
        return snap
    try:
        rows = db.table("cobrancas_extras") \
            .select("id, description, attachments, status") \
            .eq("condominio_id", pac["condominio_id"]) \
            .eq("mes", pac.get("mes_referencia")).eq("ano", pac.get("ano_referencia")) \
            .neq("status", "cancelada").execute().data or []
        incl = pac.get("cobrancas_incluidas")
        if isinstance(incl, list):
            rows = [c for c in rows if c.get("id") in incl]
        return [{"id": c.get("id"), "descricao": c.get("description"),
                 "attachments": c.get("attachments") or []} for c in rows]
    except Exception as e:
        print(f"[extrair] cobrancas: {e}")
        return []


@router.post("/emissoes/{pacote_id}/extrair-pdf")
def api_extrair_emissao_pdf(pacote_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Junta os documentos da emissão num PDF único, na ordem de auditoria."""
    import io

    pac = db.table("emissoes_pacotes") \
        .select("id, condominio_id, mes_referencia, ano_referencia, cobrancas_incluidas, cobrancas_snapshot, condominios(name)") \
        .eq("id", pacote_id).maybe_single().execute().data
    if not pac:
        raise HTTPException(404, "Emissão não encontrada.")
    if user["role"] in ("gerente", "assistente") and pac.get("condominio_id") not in carteira_condo_ids(db, user):
        raise HTTPException(403, "Este condomínio não está na sua carteira.")

    arquivos = db.table("emissoes_arquivos") \
        .select("id, arquivo_nome, arquivo_url, formato, categoria, subtipo, relatorio_tipo_servico") \
        .eq("pacote_id", pacote_id).execute().data or []

    itens = _ordenar_para_extracao(arquivos, _cobrancas_da_emissao(db, pac))
    if not itens:
        raise HTTPException(400, "Esta emissão não tem documentos para extrair.")

    try:
        import pikepdf
    except Exception:
        raise HTTPException(500, "Biblioteca de PDF indisponível no servidor.")

    saida = pikepdf.Pdf.new()
    abertos = []          # segura as referências: o pikepdf lê as páginas de forma preguiçosa
    pulados = []
    for item in itens:
        path = item.get("__attachment") or item.get("arquivo_url")
        nome = item.get("arquivo_nome") or "arquivo"
        if not path:
            continue
        try:
            dados = db.storage.from_("emissoes").download(path)
        except Exception:
            pulados.append(nome)
            continue

        low = (nome or "").lower()
        fmt = _norm_txt(item.get("formato"))
        eh_pdf = low.endswith(".pdf") or fmt == "pdf"
        try:
            if eh_pdf:
                src = pikepdf.Pdf.open(io.BytesIO(dados))
                abertos.append(src)
                saida.pages.extend(src.pages)         # cópia fiel, sem decodificar
            else:
                from PIL import Image
                img = Image.open(io.BytesIO(dados))
                if img.mode in ("RGBA", "P", "LA"):
                    img = img.convert("RGB")
                buf = io.BytesIO()
                img.save(buf, format="PDF")
                buf.seek(0)
                src = pikepdf.Pdf.open(buf)
                abertos.append(src)
                saida.pages.extend(src.pages)
        except Exception as e:
            print(f"[extrair] {nome}: {e}")
            pulados.append(nome)

    if len(saida.pages) == 0:
        raise HTTPException(400, "Nenhum documento pôde ser lido.")

    out = io.BytesIO()
    saida.save(out)
    pdf_bytes = out.getvalue()
    paginas = len(saida.pages)
    for p in abertos:
        try:
            p.close()
        except Exception:
            pass

    cnome = ((pac.get("condominios") or {}).get("name") or "emissao")
    cnome = "".join(ch if ch.isalnum() else "_" for ch in cnome).strip("_")
    fname = f"{cnome}_{int(pac.get('mes_referencia') or 0):02d}-{pac.get('ano_referencia')}.pdf"

    # Não devolvemos os bytes na resposta: a função do Vercel corta em ~4,5 MB e uma
    # emissão escaneada passa disso fácil. Sobe pro bucket e devolve link assinado curto.
    destino = f"extracoes/{pacote_id}/{int(datetime.now().timestamp())}_{fname}"
    try:
        db.storage.from_("emissoes").upload(
            destino, pdf_bytes,
            {"content-type": "application/pdf", "upsert": "true"},
        )
        assinada = db.storage.from_("emissoes").create_signed_url(destino, 600)  # 10 min
        url = assinada.get("signedURL") if isinstance(assinada, dict) else assinada
    except Exception as e:
        print(f"[extrair] upload/assinatura: {e}")
        raise HTTPException(500, "PDF montado, mas não consegui disponibilizar o download.")

    return {"url": url, "nome": fname, "paginas": paginas, "pulados": pulados}


@router.post("/emissoes/{pacote_id}/notificar")
def api_renotificar_emissao(pacote_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Re-notifica (sino + e-mail) quem precisa AGIR num pacote de emissão pendente.
    Insere uma notificação 'lembrete' p/ os alvos do status atual -> dispara o e-mail."""
    if user["role"] not in ("master", "departamento"):
        raise HTTPException(403, "Apenas master/departamento pode re-notificar.")

    pac = db.table("emissoes_pacotes").select("id, status, mes_referencia, ano_referencia, condominio_id") \
        .eq("id", pacote_id).maybe_single().execute().data
    if not pac:
        raise HTTPException(404, "Pacote não encontrado.")

    s = (pac.get("status") or "").lower()
    condo = db.table("condominios").select("name, gerente_id").eq("id", pac["condominio_id"]).maybe_single().execute().data or {}
    condo_nome = condo.get("name") or "Condomínio"
    periodo = f"{int(pac.get('mes_referencia') or 0):02d}/{pac.get('ano_referencia')}"
    titulo = "Lembrete: emissão aguardando aprovação"
    mensagem = f"{condo_nome} · {periodo} — ainda aguarda a sua aprovação."
    link = "/aprovacoes"

    alvos = set()
    if ("gerente" in s and "sup" not in s and "chefe" not in s) or s == "pendente":
        gid = condo.get("gerente_id")
        if gid:
            g = db.table("gerentes").select("profile_id").eq("id", gid).maybe_single().execute().data
            if g and g.get("profile_id"):
                alvos.add(g["profile_id"])
    elif ("chefe" in s) or ("sup_gerentes" in s) or ("sup. gerentes" in s) or ("supervisor_gerentes" in s):
        for p in (db.table("profiles").select("id").eq("role", "supervisor_gerentes").execute().data or []):
            alvos.add(p["id"])
    elif "contabil" in s:
        for p in (db.table("profiles").select("id").in_("role", ["supervisora", "supervisora_contabilidade"]).execute().data or []):
            alvos.add(p["id"])
    elif ("supervisor" in s) or ("sup" in s):
        # Fallback p/ status genérico de supervisor: contabilidade (etapa mais comum) —
        # NÃO os três, senão o sup. de gerentes recebe o que não é dele.
        for p in (db.table("profiles").select("id").in_("role", ["supervisora", "supervisora_contabilidade"]).execute().data or []):
            alvos.add(p["id"])

    if not alvos:
        return {"ok": False, "notificados": 0, "motivo": "Este pacote não está aguardando aprovação."}

    for uid in alvos:
        db.table("notificacoes").insert({
            "user_id": uid, "tipo": "emissao_lembrete",
            "titulo": titulo, "mensagem": mensagem, "link": link,
        }).execute()

    return {"ok": True, "notificados": len(alvos)}


@router.get("/condominios")
def api_condominios(user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        # Puxa os condomínios (sem join complexo para evitar travamentos)
        query = db.table("condominios").select("*").order("name")
        
        if user["role"] in ("gerente", "assistente"):
            g_id = carteira_gerente_id(db, user)
            query = query.eq("gerente_id", g_id or "00000000-0000-0000-0000-000000000000")
                
        # 3 consultas independentes EM PARALELO: condomínios + de-para de gerentes/profiles.
        from concurrent.futures import ThreadPoolExecutor
        def _q_condos():
            return query.execute().data or []
        def _q_gerentes():
            try:
                return db.table("gerentes").select("id, profile_id, nome").execute().data or []
            except Exception:
                return []
        def _q_profiles():
            try:
                return db.table("profiles").select("id, full_name, role, gerente_id").execute().data or []
            except Exception:
                # gerente_id pode não existir se a 0057 não rodou — cai no essencial
                try:
                    return db.table("profiles").select("id, full_name").execute().data or []
                except Exception:
                    return []
        with ThreadPoolExecutor(max_workers=3) as _ex:
            _fc, _fg, _fp = _ex.submit(_q_condos), _ex.submit(_q_gerentes), _ex.submit(_q_profiles)
            condos = _fc.result()
            gerentes_res = _fg.result()
            profiles_res = _fp.result()

        # Mapeamento de nomes de gerentes de forma estável
        try:
            p_map = {p["id"]: p["full_name"] for p in profiles_res}
            g_map = {
                g["id"]: p_map.get(g["profile_id"]) or g.get("nome") or "Gerente desconhecido"
                for g in gerentes_res
            }

            # Assistente do condomínio = quem está vinculado ao GERENTE dele (0057).
            # profiles.gerente_id aponta pro PROFILE do gerente, não pro gerentes.id.
            por_gpid = {}
            for p in profiles_res:
                if p.get("role") == "assistente" and p.get("gerente_id") and p.get("full_name"):
                    por_gpid.setdefault(p["gerente_id"], []).append(p["full_name"])
            a_map = {
                g["id"]: ", ".join(sorted(por_gpid[g["profile_id"]]))
                for g in gerentes_res
                if g.get("profile_id") and por_gpid.get(g["profile_id"])
            }

            for c in condos:
                c["gerente_name"] = g_map.get(c.get("gerente_id"), "Gerente não definido")
                c["assistente_nome"] = a_map.get(c.get("gerente_id"))
        except Exception as inner_e:
            print(f"Erro ao mapear gerentes: {inner_e}")
            for c in condos:
                c["gerente_name"] = "Gerente não definido"
                c["assistente_nome"] = None

        return {"condos": condos}
    except Exception as e:
        print(f"Erro crítico /condominios: {e}")
        raise HTTPException(500, str(e))

class CondoData(BaseModel):
    # Tudo que o formulário deixa em branco chega como "" — por isso é Optional aqui
    # e vira None no payload. Campo obrigatório de verdade é só o nome.
    #
    # `assistente` e `fluxo` continuam aceitos e IGNORADOS: nenhuma dessas colunas
    # existe em `condominios` (conferido em todas as migrations 0001→0079), e mandá-las
    # fazia o PostgREST responder PGRST204 e derrubar o cadastro inteiro. O assistente
    # real vem de profiles.gerente_id (0057); `fluxo` é coluna de `processos`.
    id: Optional[str] = None
    name: str
    due_day: Optional[str] = None
    due_day_2: Optional[str] = None
    gerente_id: Optional[str] = None
    cnpj: Optional[str] = None
    tem_consumo: Optional[bool] = None   # 0091 — depende de concessionária
    prazo_expedicao_dia: Optional[str] = None   # 0096 — dia limite p/ expedir
    prioridade_motivo: Optional[str] = None      # 0096 — por que é prioritário
    usa_filipeta: Optional[bool] = None          # 0110 — manda filipeta junto com o boleto
    assistente: Optional[str] = None   # ignorado
    fluxo: Optional[int] = None        # ignorado


def _dia_vencimento(v, rotulo):
    """'' e None viram NULL; '5' vira 5. A coluna é INTEGER com CHECK 1..31 —
    mandar string vazia estourava 'invalid input syntax for type integer: ""'
    e derrubava o cadastro inteiro (o campo é opcional no formulário)."""
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    try:
        n = int(float(s))
    except (TypeError, ValueError):
        raise HTTPException(400, f"{rotulo}: '{v}' não é um dia válido.")
    if not 1 <= n <= 31:
        raise HTTPException(400, f"{rotulo} precisa ser entre 1 e 31 (recebi {n}).")
    return n


class CondoImportItem(BaseModel):
    name: str
    due_day: Optional[int] = None
    due_day_2: Optional[int] = None
    cnpj: Optional[str] = None
    gerente: Optional[str] = None       # nome digitado na planilha


class CondoImportPayload(BaseModel):
    itens: List[CondoImportItem]
    confirmar: bool = False             # False = só simula e devolve o que faria


@router.post("/condominios/importar")
def api_importar_condominios(data: CondoImportPayload, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Importa condomínios em lote a partir de uma planilha.

    Com `confirmar=False` NADA é gravado: devolve linha a linha o que aconteceria.
    A tela usa isso para mostrar a prévia antes de o usuário decidir. Nunca sobrescreve
    condomínio existente — quem já está lá é só reportado como 'existe'."""
    if user["role"] != "master":
        raise HTTPException(403, "Apenas o master pode importar condomínios.")
    if not data.itens:
        raise HTTPException(400, "Nenhuma linha para importar.")
    if len(data.itens) > 1000:
        raise HTTPException(400, "Limite de 1000 linhas por importação. Divida a planilha.")

    def _chave(s):
        import unicodedata
        s = unicodedata.normalize("NFD", str(s or "")).lower()
        s = "".join(c for c in s if unicodedata.category(c) != "Mn")
        return " ".join(s.split())

    # Existentes: para não duplicar. Uma consulta só.
    existentes = {}
    try:
        for c in (db.table("condominios").select("id, name").execute().data or []):
            existentes[_chave(c["name"])] = c["id"]
    except Exception as e:
        raise HTTPException(500, f"Não consegui ler os condomínios atuais: {e}")

    # De-para de gerentes por nome: aceita o nome do profile e o da tabela gerentes.
    ger_por_nome = {}
    try:
        gers = db.table("gerentes").select("id, nome, profile_id").execute().data or []
        profs = db.table("profiles").select("id, full_name").execute().data or []
        p_map = {p["id"]: p.get("full_name") for p in profs}
        for g in gers:
            for nome in (p_map.get(g.get("profile_id")), g.get("nome")):
                if nome:
                    ger_por_nome.setdefault(_chave(nome), g["id"])
    except Exception as e:
        print(f"[condominios/importar] de-para de gerentes indisponível: {e}")

    resultados, novos = [], []
    vistos_no_lote = set()
    for item in data.itens:
        nome = (item.name or "").strip()
        linha = {"name": nome, "status": None, "motivo": None}

        if not nome:
            linha.update(status="erro", motivo="sem nome")
            resultados.append(linha); continue

        k = _chave(nome)
        if k in existentes:
            linha.update(status="existe", motivo="já cadastrado")
            resultados.append(linha); continue
        if k in vistos_no_lote:
            linha.update(status="erro", motivo="repetido na planilha")
            resultados.append(linha); continue

        for dia, rot in ((item.due_day, "vencimento"), (item.due_day_2, "2º vencimento")):
            if dia is not None and not 1 <= dia <= 31:
                linha.update(status="erro", motivo=f"{rot} fora de 1–31")
        if linha["status"] == "erro":
            resultados.append(linha); continue

        gid = None
        if item.gerente:
            gid = ger_por_nome.get(_chave(item.gerente))
            if not gid:
                linha.update(status="erro", motivo=f"gerente '{item.gerente}' não encontrado")
                resultados.append(linha); continue

        cnpj = "".join(ch for ch in (item.cnpj or "") if ch.isdigit()) or None
        if cnpj and len(cnpj) != 14:
            linha.update(status="erro", motivo="CNPJ não tem 14 dígitos")
            resultados.append(linha); continue

        vistos_no_lote.add(k)
        novos.append({
            "name": nome, "due_day": item.due_day, "due_day_2": item.due_day_2,
            "cnpj": cnpj, "gerente_id": gid,
        })
        linha.update(status="novo", motivo=None)
        resultados.append(linha)

    resumo = {
        "novos": sum(1 for r in resultados if r["status"] == "novo"),
        "existentes": sum(1 for r in resultados if r["status"] == "existe"),
        "erros": sum(1 for r in resultados if r["status"] == "erro"),
    }

    if not data.confirmar:
        return {"simulacao": True, "resumo": resumo, "resultados": resultados}

    inseridos = 0
    if novos:
        # Em blocos: um INSERT gigante estoura o tempo da função no Vercel.
        for i in range(0, len(novos), 100):
            bloco = novos[i:i + 100]
            try:
                db.table("condominios").insert(bloco).execute()
                inseridos += len(bloco)
            except Exception as e:
                print(f"[condominios/importar] bloco {i}: {e}")
                raise HTTPException(400, f"Falhou ao gravar a partir de '{bloco[0]['name']}': {e}")

    return {"simulacao": False, "resumo": {**resumo, "inseridos": inseridos}, "resultados": resultados}


@router.get("/condominos")
def api_listar_condominos(condominio_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Moradores de um condomínio + quantos estão prontos para a 2ª via.

    "Pronto" = tem CPF, é responsável pelo pagamento e tem e-mail — os três que
    `_verificar_condomino` e `_contatos_unidade` exigem para o fluxo do WhatsApp
    passar da etapa do CPF."""
    if user["role"] not in ("master", "departamento"):
        raise HTTPException(403, "Sem permissão para ver os moradores.")
    try:
        rows = db.table("condominos").select(
            "id, unidade, bloco, nome, tipo, cpf, telefone, email, responsavel_pagamento, ativo"
        ).eq("condominio_id", condominio_id).order("unidade").execute().data or []
    except Exception as e:
        raise HTTPException(500, f"Não consegui ler os moradores: {e}")

    unidades = {}
    for r in rows:
        u = (r.get("unidade") or "").strip().upper()
        unidades.setdefault(u, []).append(r)

    prontas = sum(
        1 for lista in unidades.values()
        if any(r.get("cpf") and r.get("responsavel_pagamento") for r in lista)
        and any(r.get("email") for r in lista)
    )
    return {
        "condominos": rows,
        "resumo": {
            "registros": len(rows),
            "unidades": len(unidades),
            "com_cpf": sum(1 for r in rows if r.get("cpf")),
            "unidades_prontas": prontas,
        },
    }


class CondominoCpfItem(BaseModel):
    unidade: str
    bloco: Optional[str] = None
    cpf: str


class CondominosCpfPayload(BaseModel):
    condominio_id: str
    itens: List[CondominoCpfItem]
    confirmar: bool = False


@router.post("/condominos/cpf")
def api_definir_cpf_condominos(data: CondominosCpfPayload, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Preenche o CPF do responsável por unidade — a peça que falta para o WhatsApp.

    Casa por unidade (+ bloco) e grava o CPF em quem já é `responsavel_pagamento`.
    Se a unidade não tiver responsável marcado, marca o primeiro proprietário.
    Com `confirmar=False` apenas simula.

    LGPD: CPF é dado sensível — nada de payload nos logs, só contagens.
    """
    if user["role"] != "master":
        raise HTTPException(403, "Apenas o master pode definir CPF de moradores.")
    if not data.itens:
        raise HTTPException(400, "Nenhuma linha enviada.")

    try:
        rows = db.table("condominos").select("id, unidade, bloco, nome, tipo, cpf, responsavel_pagamento") \
            .eq("condominio_id", data.condominio_id).execute().data or []
    except Exception as e:
        raise HTTPException(500, f"Não consegui ler os moradores: {e}")

    porUnidade = {}
    for r in rows:
        chave = ((r.get("unidade") or "").strip().upper(), (r.get("bloco") or "").strip().upper())
        porUnidade.setdefault(chave, []).append(r)

    alteracoes, resultados = [], []
    for item in data.itens:
        unidade = (item.unidade or "").strip()
        cpf = "".join(ch for ch in (item.cpf or "") if ch.isdigit())
        linha = {"unidade": unidade, "status": None, "motivo": None}

        if not unidade:
            linha.update(status="erro", motivo="sem unidade"); resultados.append(linha); continue
        if len(cpf) != 11:
            linha.update(status="erro", motivo=f"CPF com {len(cpf)} dígitos (esperado 11)")
            resultados.append(linha); continue

        chave = (unidade.upper(), (item.bloco or "").strip().upper())
        candidatos = porUnidade.get(chave)
        if candidatos is None and not item.bloco:
            # Sem bloco informado: aceita a unidade em qualquer bloco, se for só uma.
            achados = [v for k, v in porUnidade.items() if k[0] == unidade.upper()]
            candidatos = achados[0] if len(achados) == 1 else None
        if not candidatos:
            linha.update(status="erro", motivo="unidade não encontrada")
            resultados.append(linha); continue

        alvo = next((r for r in candidatos if r.get("responsavel_pagamento")), None) \
            or next((r for r in candidatos if r.get("tipo") == "proprietario"), None) \
            or candidatos[0]

        if (alvo.get("cpf") or "") == cpf and alvo.get("responsavel_pagamento"):
            linha.update(status="ja_ok", motivo="já estava assim")
        else:
            alteracoes.append((alvo["id"], {"cpf": cpf, "responsavel_pagamento": True}))
            linha.update(status="definido", motivo=(alvo.get("nome") or None))
        resultados.append(linha)

    resumo = {
        "definidos": sum(1 for r in resultados if r["status"] == "definido"),
        "ja_ok": sum(1 for r in resultados if r["status"] == "ja_ok"),
        "erros": sum(1 for r in resultados if r["status"] == "erro"),
    }
    if not data.confirmar:
        return {"simulacao": True, "resumo": resumo, "resultados": resultados[:400]}

    gravados = 0
    try:
        for cid, campos in alteracoes:
            db.table("condominos").update(campos).eq("id", cid).execute()
            gravados += 1
    except Exception as e:
        print(f"[condominos/cpf] falha após {gravados} atualizações: {type(e).__name__}")
        raise HTTPException(400, f"Falhou ao gravar: {e}")

    print(f"[condominos/cpf] condo={data.condominio_id} definidos={gravados}")
    return {"simulacao": False, "resumo": {**resumo, "gravados": gravados}, "resultados": resultados[:400]}




class CondominoItem(BaseModel):
    unidade: str
    bloco: Optional[str] = None
    nome: Optional[str] = None
    tipo: Optional[str] = None            # 'proprietario' | 'locatario'
    email: Optional[str] = None
    telefone: Optional[str] = None
    responsavel_pagamento: bool = False


class CondominosImportPayload(BaseModel):
    condominio_id: Optional[str] = None
    criar_condominio: Optional[dict] = None   # {name, cnpj} quando não existe ainda
    linhas: List[CondominoItem]
    confirmar: bool = False


@router.post("/condominos/importar")
def api_importar_condominos(data: CondominosImportPayload, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Importa a Relação de Condôminos (unidades + contatos) de um condomínio.

    Com `confirmar=False` NADA é gravado — devolve o que aconteceria, para a prévia.
    Nunca apaga: quem está no banco e não veio no relatório é só reportado. Preserva
    `cpf` e `responsavel_pagamento` já ajustados à mão (o relatório não traz CPF).

    LGPD: nome, telefone e e-mail de moradores. Os logs daqui levam SÓ contagens.
    """
    if user["role"] != "master":
        raise HTTPException(403, "Apenas o master pode importar condôminos.")
    if not data.linhas:
        raise HTTPException(400, "Nenhuma linha para importar.")
    if len(data.linhas) > 5000:
        raise HTTPException(400, "Limite de 5000 linhas por importação.")

    # ── 1. Resolver o condomínio: por CNPJ, por id, ou criar ────────────────────
    condo_id = data.condominio_id
    condo_nome = None
    criado = False
    cnpj = "".join(ch for ch in ((data.criar_condominio or {}).get("cnpj") or "") if ch.isdigit())

    if not condo_id and cnpj:
        try:
            achado = db.table("condominios").select("id, name").eq("cnpj", cnpj).limit(1).execute().data or []
            if achado:
                condo_id, condo_nome = achado[0]["id"], achado[0]["name"]
        except Exception as e:
            print(f"[condominos/importar] busca por cnpj: {e}")

    if not condo_id:
        nome_novo = ((data.criar_condominio or {}).get("name") or "").strip()
        if not nome_novo:
            raise HTTPException(400, "Informe o condomínio (existente ou a criar).")
        if data.confirmar:
            try:
                novo = db.table("condominios").insert(
                    {"name": nome_novo, "cnpj": cnpj or None}
                ).execute().data
                condo_id = (novo or [{}])[0].get("id")
                criado = True
            except Exception as e:
                raise HTTPException(400, f"Não consegui criar o condomínio: {e}")
        condo_nome = nome_novo
    elif not condo_nome:
        try:
            r = db.table("condominios").select("name").eq("id", condo_id).limit(1).execute().data or []
            condo_nome = (r[0]["name"] if r else None)
        except Exception:
            pass

    # ── 2. O que já existe (para diferenciar novo × atualizado) ─────────────────
    existentes = {}
    if condo_id:
        try:
            for r in (db.table("condominos").select("id, unidade, bloco, email")
                      .eq("condominio_id", condo_id).execute().data or []):
                chave = ((r.get("unidade") or "").strip().upper(),
                         (r.get("bloco") or "").strip().upper(),
                         (r.get("email") or "").strip().lower())
                existentes[chave] = r["id"]
        except Exception as e:
            print(f"[condominos/importar] leitura do existente falhou: {e}")

    # ── 3. Classificar cada linha ──────────────────────────────────────────────
    inserir, atualizar, resultados = [], [], []
    vistos = set()
    for item in data.linhas:
        unidade = (item.unidade or "").strip()
        if not unidade:
            resultados.append({"unidade": "", "status": "erro", "motivo": "sem unidade"})
            continue

        bloco = (item.bloco or "").strip() or None
        email = (item.email or "").strip().lower() or None
        chave = (unidade.upper(), (bloco or "").upper(), (email or ""))

        if chave in vistos:
            resultados.append({"unidade": unidade, "status": "erro", "motivo": "repetido no relatório"})
            continue
        vistos.add(chave)

        registro = {
            "condominio_id": condo_id,
            "unidade": unidade,
            "bloco": bloco,
            "nome": (item.nome or "").strip() or None,
            "tipo": item.tipo if item.tipo in ("proprietario", "locatario") else None,
            "email": email,
            "telefone": "".join(ch for ch in (item.telefone or "") if ch.isdigit()) or None,
            "ativo": True,
        }

        antigo = existentes.get(chave)
        if antigo:
            # NÃO mexe em cpf nem responsavel_pagamento: podem ter sido ajustados à mão,
            # e o relatório não traz CPF para reafirmar.
            atualizar.append((antigo, {k: v for k, v in registro.items() if k != "condominio_id"}))
            resultados.append({"unidade": unidade, "email": email, "status": "atualizado"})
        else:
            registro["responsavel_pagamento"] = bool(item.responsavel_pagamento)
            inserir.append(registro)
            resultados.append({"unidade": unidade, "email": email,
                               "status": "novo" if email else "novo_sem_email"})

    resumo = {
        "condominio": condo_nome,
        "condominio_novo": not data.condominio_id and not (condo_id and not criado),
        "unidades": len({(r.get("unidade") or "").upper() for r in resultados if r.get("unidade")}),
        "novos": len(inserir),
        "atualizados": len(atualizar),
        "sem_email": sum(1 for r in resultados if r["status"] == "novo_sem_email"),
        "erros": sum(1 for r in resultados if r["status"] == "erro"),
        "no_banco_fora_do_relatorio": max(0, len(existentes) - len(atualizar)),
    }

    if not data.confirmar:
        return {"simulacao": True, "resumo": resumo, "resultados": resultados[:400]}

    gravados = 0
    try:
        for i in range(0, len(inserir), 100):
            db.table("condominos").insert(inserir[i:i + 100]).execute()
            gravados += len(inserir[i:i + 100])
        for cid, campos in atualizar:
            db.table("condominos").update(campos).eq("id", cid).execute()
    except Exception as e:
        # Sem payload no log: dado pessoal.
        print(f"[condominos/importar] falha ao gravar após {gravados} inserções: {type(e).__name__}")
        raise HTTPException(400, f"Falhou ao gravar os condôminos: {e}")

    print(f"[condominos/importar] condo={condo_id} novos={gravados} atualizados={len(atualizar)}")
    return {"simulacao": False,
            "resumo": {**resumo, "inseridos": gravados, "condominio_id": condo_id, "condominio_criado": criado},
            "resultados": resultados[:400]}


def _resolver_gerente_id(db: Client, valor):
    """Devolve sempre um `gerentes.id` válido (ou None).

    O dropdown do cadastro é montado a partir de PROFILES (role='gerente'), mas
    `condominios.gerente_id` é FK para `gerentes.id`. Mandar o id do profile direto
    estourava 23503 (violates foreign key constraint). Aceitamos os dois formatos e
    normalizamos aqui, que é o único lugar por onde a gravação passa."""
    if not valor:
        return None
    try:
        if (db.table("gerentes").select("id").eq("id", valor).limit(1).execute().data or []):
            return valor                      # já veio como gerentes.id
        achado = db.table("gerentes").select("id").eq("profile_id", valor).limit(1).execute().data or []
        if achado:
            return achado[0]["id"]            # veio o profile do gerente
    except Exception as e:
        print(f"[condominios/salvar] resolver gerente {valor}: {e}")
        raise HTTPException(400, "Não consegui validar o gerente escolhido.")
    raise HTTPException(
        400,
        "Esse gerente ainda não tem carteira criada. Abra Admin › Usuários e vincule-o "
        "como gerente antes de atribuir condomínios a ele.",
    )


def _garantir_grupos(db: Client, condominio_id: str, due_day, due_day_2) -> None:
    """Todo condomínio precisa ter ao menos o grupo 'Geral' (0086).

    O backfill da 0086 só alcançou quem já existia. Condomínio cadastrado depois
    ficava sem grupo nenhum — e a tela de emissão, que espera os grupos do
    condomínio antes de abrir o pacote, esperava para sempre, sem erro nenhum.

    Idempotente: a tabela tem UNIQUE(condominio_id, nome), e o insert de um nome
    repetido é ignorado. Nunca derruba o cadastro: se os grupos falharem, o
    condomínio já está salvo e é isso que importa aqui.
    """
    try:
        existentes = db.table("condominio_grupos").select("nome, due_day") \
            .eq("condominio_id", condominio_id).execute().data or []
        nomes = {g["nome"] for g in existentes}

        if "Geral" not in nomes:
            db.table("condominio_grupos").insert({
                "condominio_id": condominio_id, "nome": "Geral",
                "due_day": due_day, "ordem": 0,
            }).execute()
        else:
            # O grupo SEGUE o cadastro quando o vencimento muda.
            #
            # Esta funcao so criava o grupo que faltava. Trocar o dia no
            # cadastro deixava o grupo "Geral" com o dia antigo — e quem manda
            # na emissao e o GRUPO. O cadastro dizia 10, o boleto saia dia 1, e
            # nao havia erro nenhum na tela para denunciar.
            #
            # Aconteceu de verdade com o 411 em 23/08/2026, minutos depois de
            # alguem trocar o vencimento para 10.
            atual = next((g for g in existentes if g["nome"] == "Geral"), None)
            if atual and atual.get("due_day") != due_day:
                db.table("condominio_grupos").update({"due_day": due_day}) \
                  .eq("condominio_id", condominio_id).eq("nome", "Geral").execute()

        # Segundo vencimento ganha o seu grupo, com o mesmo nome genérico que a
        # 0086 usou — quem conhece o condomínio renomeia depois.
        if due_day_2:
            nome2 = f"Vencimento dia {due_day_2}"
            if nome2 not in nomes:
                db.table("condominio_grupos").insert({
                    "condominio_id": condominio_id, "nome": nome2,
                    "due_day": due_day_2, "ordem": 1,
                }).execute()
    except Exception as e:
        print(f"[condominios/grupos] nao criei os grupos de {condominio_id}: {type(e).__name__}: {e}")


@router.post("/condominios/salvar")
def api_salvar_condominio(data: CondoData, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    # Fora do try: HTTPException também é Exception, e o except abaixo estava
    # capturando o próprio 403 e devolvendo como 400 "403: Apenas master".
    if user["role"] != "master":
        raise HTTPException(403, "Apenas o master pode cadastrar ou editar condomínios.")

    nome = (data.name or "").strip()
    if not nome:
        raise HTTPException(400, "O nome do condomínio é obrigatório.")

    # SÓ colunas que existem de verdade em `condominios`. É a mesma base pela qual os
    # 300+ condomínios entraram (0002/0023: name + due_day), mais o gerente e o que
    # foi criado depois: due_day_2 (0054) e cnpj (0042).
    payload = {
        "name": nome,
        "due_day": _dia_vencimento(data.due_day, "1º vencimento"),
        "due_day_2": _dia_vencimento(data.due_day_2, "2º vencimento"),
        "gerente_id": _resolver_gerente_id(db, (data.gerente_id or "").strip() or None),
        "cnpj": ((data.cnpj or "").strip() or None),
        # A coluna é NOT NULL DEFAULT false (0091); None viraria erro, não "deixa
        # como está" — por isso o bool() em vez de repassar o Optional cru.
        "tem_consumo": bool(data.tem_consumo),
        # Prazo de ENTREGA, nao de vencimento. Mesmo tratamento dos dias:
        # "" vira NULL em vez de estourar no INTEGER.
        "prazo_expedicao_dia": _dia_vencimento(data.prazo_expedicao_dia, "prazo de expedição"),
        "prioridade_motivo": ((data.prioridade_motivo or "").strip() or None),
        # NOT NULL DEFAULT false (0110), mesmo caso do tem_consumo: None
        # estouraria em vez de significar "deixa como está".
        "usa_filipeta": bool(data.usa_filipeta),
    }
    try:
        if data.id:
            db.table("condominios").update(payload).eq("id", data.id).execute()
            _garantir_grupos(db, data.id, payload["due_day"], payload["due_day_2"])
        else:
            novo = db.table("condominios").insert(payload).execute().data or []
            if novo:
                _garantir_grupos(db, novo[0]["id"], payload["due_day"], payload["due_day_2"])
    except Exception as e:
        msg = str(e)

        # A 0110 pode não ter rodado ainda. Sem esta saída, o dia em que o código
        # sobe antes da migration é o dia em que NINGUÉM consegue salvar
        # condomínio — por causa de uma caixinha nova de marcar. Grava sem ela e
        # deixa o rastro no log; a marca entra quando a coluna existir.
        if "usa_filipeta" in msg and ("PGRST204" in msg or "schema cache" in msg):
            print("[condominios/salvar] sem a coluna usa_filipeta (0110 não rodou); salvando sem ela")
            payload.pop("usa_filipeta", None)
            try:
                if data.id:
                    db.table("condominios").update(payload).eq("id", data.id).execute()
                    _garantir_grupos(db, data.id, payload["due_day"], payload["due_day_2"])
                else:
                    novo = db.table("condominios").insert(payload).execute().data or []
                    if novo:
                        _garantir_grupos(db, novo[0]["id"], payload["due_day"], payload["due_day_2"])
                return {"success": True, "aviso": "A marca de filipeta não foi salva: falta rodar a migration 0110."}
            except Exception as e2:
                msg = str(e2)

        print(f"[condominios/salvar] falhou: {msg} | payload={payload}")
        # Traduz os erros que já morderam aqui, para a tela não mostrar erro cru do Postgres
        if "PGRST204" in msg or "schema cache" in msg:
            raise HTTPException(400, f"O banco não tem uma das colunas enviadas. Detalhe: {msg}")
        if "23503" in msg or "foreign key" in msg:
            raise HTTPException(400, "O gerente escolhido não existe mais. Recarregue a página e tente de novo.")
        if "23505" in msg or "duplicate key" in msg:
            raise HTTPException(400, "Já existe um condomínio com esse nome.")
        if "23514" in msg or "check constraint" in msg:
            raise HTTPException(400, "Algum valor está fora do permitido (o dia de vencimento precisa ser 1–31).")
        raise HTTPException(400, f"Não consegui salvar o condomínio: {msg}")

    return {"success": True}

@router.get("/carteiras")
def api_carteiras(user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        # Puxa todos os gerentes e seus condomínios vinculados
        query = db.table("gerentes").select("id, profile_id, profiles(full_name), condominios(*)")
        res = query.execute().data
        
        # Assistentes de verdade: profiles.role='assistente' + gerente_id = profile do
        # gerente (0057). Uma consulta só, mapeada por profile do gerente.
        por_gpid = {}
        try:
            assist = db.table("profiles").select("full_name, gerente_id") \
                .eq("role", "assistente").execute().data or []
            for a in assist:
                if a.get("gerente_id") and a.get("full_name"):
                    por_gpid.setdefault(a["gerente_id"], []).append(a["full_name"])
        except Exception as e:
            print(f"[carteiras] assistentes por vínculo indisponíveis: {e}")

        # Legado: mapa fixo de nomes, usado só para quem ainda não foi vinculado no
        # /admin/usuarios. Apagar quando todos os assistentes estiverem vinculados —
        # nome cravado em código quebra na primeira contratação ou saída.
        mapa_assistentes = {
            "Aline": "Vânia",
            "Eduardo": "Mayara",
            "Diogo": "Renata",
            "Marlei": "Sem Associação",
            "Mauro Jr": "Sem Associação"
        }

        carteiras = []
        for row in res:
            condos = row.get("condominios", [])
            gerente_full = row.get('profiles', {}).get('full_name', 'Sem Nome')

            primeiro_nome = gerente_full.split(" ")[0] if gerente_full else ""

            vinculados = por_gpid.get(row.get("profile_id")) or []
            if vinculados:
                assistente = ", ".join(sorted(vinculados))
            else:
                assistente = mapa_assistentes.get(primeiro_nome, "—")

            carteiras.append({
                "nome": gerente_full,
                "assistente": assistente,
                "count": len(condos),
                "condominios": condos
            })
                
        return {"carteiras": carteiras}
    except Exception as e:
        print(f"CRITICAL ERROR /carteiras: {e}")
        return {"carteiras": [], "error": str(e)}

@router.get("/aprovacoes")
def api_aprovacoes(user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        role = user.get('role')
        
        query = db.table("processos").select("id, year, semester, status, condominio_id, emitido_por, condominios(name)")
        
        if role in ROLES_APROVADORES or role == 'supervisor_gerentes':
            status_target = []
            if role == 'master':
                pass
            elif role == 'gerente':
                status_target = ['Aguardando Gerente']
            elif role == 'supervisora':
                status_target = ['Aguardando Supervisora']
            elif role == 'supervisora_contabilidade':
                status_target = ['Aguardando Sp. Contabilidade']
            elif role == 'supervisor_gerentes':
                status_target = ['Aguardando Sup. Gerentes']
                
            if status_target:
                query = query.in_("status", status_target)
            else:
                query = query.like("status", "Aguardando%")

            # Gerente vê só dos condomínios dele
            if role == 'gerente':
                g_id = get_gerente_id(db, user['id'])
                if g_id:
                    condos_res = db.table("condominios").select("id").eq("gerente_id", g_id).execute()
                    condo_ids = [c['id'] for c in (condos_res.data or [])]
                    if condo_ids:
                        query = query.in_("condominio_id", condo_ids)
                    else:
                        query = query.in_("condominio_id", ["00000000-0000-0000-0000-000000000000"]) # Retorna nada
        elif role in ['emissor', 'assistente', 'departamento']:
            query = query.eq("status", "Solicitar alteração")
            
        pendentes_res = query.execute().data
        
        # historico
        hist_res = db.table("aprovacoes").select("id, action, comment, created_at, profiles(full_name), processos(year, semester, condominios(name))").order('created_at', desc=True).limit(20).execute().data
        
        return {
            "pendentes": pendentes_res or [],
            "historico": hist_res or []
        }
    except Exception as e:
        print(f"CRITICAL ERROR /aprovacoes: {e}")
        return {"pendentes": [], "historico": [], "error": str(e)}

@router.get("/auditoria")
def api_auditoria(
    condo_id: str = None,
    gerente_id: str = None,
    date_from: str = None,
    date_to: str = None,
    search: str = None,
    etapa: str = None,
    limit: int = 80,
    offset: int = 0,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    try:
        if user["role"] not in VIEW_AUDITORIA and user["role"] != 'gerente':
            raise HTTPException(403, "Acesso negado")

        CAP = 300  # por fonte
        dt_to = (date_to + "T23:59:59") if date_to else None
        eventos = []
        ids_perfil = set()  # ids a resolver nome depois (aberto_por / criado_por)

        def _per(mes, ano):
            try:
                return (f"{int(mes):02d}/{ano}" if mes else (str(ano) if ano else ""))
            except Exception:
                return ""

        from concurrent.futures import ThreadPoolExecutor

        # 1) Arrecadação — aprovacoes
        def _src1():
            try:
                q = db.table("aprovacoes").select(
                    "id, action, comment, created_at, approver:approver_id(full_name, role), "
                    "processo:processo_id(year, semester, condominio_id, condominios(name, gerente_id))"
                ).order("created_at", desc=True).limit(CAP)
                if date_from: q = q.gte("created_at", date_from)
                if dt_to: q = q.lte("created_at", dt_to)
                for r in (q.execute().data or []):
                    proc = r.get("processo") or {}
                    cond = proc.get("condominios") or {}
                    ap = r.get("approver") or {}
                    eventos.append({
                        "id": f"arr:{r['id']}", "quando": r.get("created_at"), "etapa": "Arrecadação",
                        "acao": r.get("action") or "—", "ator": ap.get("full_name"), "ator_role": ap.get("role"),
                        "condominio_id": proc.get("condominio_id"), "condominio_nome": cond.get("name"),
                        "gerente_id": cond.get("gerente_id"), "motivo": r.get("comment"),
                        "ref": f"{proc.get('year')}/{proc.get('semester')}" if proc.get("year") else "",
                    })
            except Exception as e:
                print(f"[auditoria] aprovacoes: {e}")

        # 2) Emissão · aprovação — emissoes_pacotes_aprovacoes
        def _src2():
            try:
                q = db.table("emissoes_pacotes_aprovacoes").select(
                    "id, acao, role, usuario_nome, criado_em, "
                    "pacote:pacote_id(mes_referencia, ano_referencia, condominio_id, condominios(name, gerente_id))"
                ).order("criado_em", desc=True).limit(CAP)
                if date_from: q = q.gte("criado_em", date_from)
                if dt_to: q = q.lte("criado_em", dt_to)
                for r in (q.execute().data or []):
                    pac = r.get("pacote") or {}
                    cond = pac.get("condominios") or {}
                    eventos.append({
                        "id": f"pacapr:{r['id']}", "quando": r.get("criado_em"), "etapa": "Emissão · aprovação",
                        "acao": ("Solicitou correção" if r.get("acao") == "correcao" else "Aprovou"),
                        "ator": r.get("usuario_nome"), "ator_role": r.get("role"),
                        "condominio_id": pac.get("condominio_id"), "condominio_nome": cond.get("name"),
                        "gerente_id": cond.get("gerente_id"), "motivo": None,
                        "ref": _per(pac.get("mes_referencia"), pac.get("ano_referencia")),
                    })
            except Exception as e:
                print(f"[auditoria] pacotes_aprovacoes: {e}")

        # 3) Arquivos postados — emissoes_arquivos
        def _src3():
            try:
                q = db.table("emissoes_arquivos").select(
                    "id, arquivo_nome, arquivo_url, tipo, mes_referencia, ano_referencia, criado_em, "
                    "condominio_id, condominios(name, gerente_id), uploaded:uploaded_by(full_name, role)"
                ).order("criado_em", desc=True).limit(CAP)
                if date_from: q = q.gte("criado_em", date_from)
                if dt_to: q = q.lte("criado_em", dt_to)
                for r in (q.execute().data or []):
                    cond = r.get("condominios") or {}
                    up = r.get("uploaded") or {}
                    eventos.append({
                        "id": f"arq:{r['id']}", "quando": r.get("criado_em"), "etapa": "Arquivo",
                        "acao": f"Postou arquivo · {r.get('tipo') or 'arquivo'}",
                        "ator": up.get("full_name"), "ator_role": up.get("role"),
                        "condominio_id": r.get("condominio_id"), "condominio_nome": cond.get("name"),
                        "gerente_id": cond.get("gerente_id"), "motivo": None,
                        "ref": _per(r.get("mes_referencia"), r.get("ano_referencia")),
                        "arquivo_nome": r.get("arquivo_nome"), "arquivo_url": r.get("arquivo_url"),
                    })
            except Exception as e:
                print(f"[auditoria] arquivos: {e}")

        # 4) Edição mensal — edicoes_mensais (abertura/reabertura)
        def _src4():
            try:
                q = db.table("edicoes_mensais").select(
                    "id, status, mes_referencia, ano_referencia, aberto_por, aberto_em, "
                    "condominio_id, condominios(name, gerente_id)"
                ).order("aberto_em", desc=True).limit(CAP)
                if date_from: q = q.gte("aberto_em", date_from)
                if dt_to: q = q.lte("aberto_em", dt_to)
                for r in (q.execute().data or []):
                    cond = r.get("condominios") or {}
                    if r.get("aberto_por"): ids_perfil.add(r["aberto_por"])
                    eventos.append({
                        "id": f"edm:{r['id']}", "quando": r.get("aberto_em"), "etapa": "Edição mensal",
                        "acao": "Abriu/atualizou edição do mês", "ator_id": r.get("aberto_por"),
                        "ator": None, "ator_role": None,
                        "condominio_id": r.get("condominio_id"), "condominio_nome": cond.get("name"),
                        "gerente_id": cond.get("gerente_id"), "motivo": f"status: {r.get('status')}",
                        "ref": _per(r.get("mes_referencia"), r.get("ano_referencia")),
                    })
            except Exception as e:
                print(f"[auditoria] edicoes_mensais: {e}")

        # 5) Conferência — emissoes_ocorrencias
        def _src5():
            try:
                q = db.table("emissoes_ocorrencias").select(
                    "id, tipo, origem, status, descricao, criado_em, criado_por, criado_por_role, "
                    "condominio_id, condominios(name, gerente_id)"
                ).order("criado_em", desc=True).limit(CAP)
                if date_from: q = q.gte("criado_em", date_from)
                if dt_to: q = q.lte("criado_em", dt_to)
                for r in (q.execute().data or []):
                    cond = r.get("condominios") or {}
                    if r.get("criado_por"): ids_perfil.add(r["criado_por"])
                    org = r.get("origem")
                    if org == "reabertura": acao = "Mês reaberto"
                    elif org == "correcao": acao = "Correção solicitada"
                    elif r.get("tipo") == "ocorrencia": acao = "Registrou ocorrência"
                    else: acao = "Registrou solicitação"
                    eventos.append({
                        "id": f"ocr:{r['id']}", "quando": r.get("criado_em"), "etapa": "Conferência",
                        "acao": acao, "ator_id": r.get("criado_por"), "ator": None,
                        "ator_role": r.get("criado_por_role"),
                        "condominio_id": r.get("condominio_id"), "condominio_nome": cond.get("name"),
                        "gerente_id": cond.get("gerente_id"), "motivo": r.get("descricao"),
                        "ref": "", "status": r.get("status"),
                    })
            except Exception as e:
                print(f"[auditoria] ocorrencias: {e}")

        # As 5 fontes são independentes → rodam EM PARALELO (append em list / add em
        # set são atômicos sob o GIL). Antes: 5 idas sequenciais ao banco (~200ms).
        with ThreadPoolExecutor(max_workers=5) as _ex:
            for _f in [_ex.submit(fn) for fn in (_src1, _src2, _src3, _src4, _src5)]:
                _f.result()

        # Resolve nomes (aberto_por / criado_por -> profiles)
        if ids_perfil:
            try:
                profs = db.table("profiles").select("id, full_name, role").in_("id", list(ids_perfil)).execute().data or []
                nmap = {p["id"]: p for p in profs}
                for ev in eventos:
                    pid = ev.get("ator_id")
                    if pid and not ev.get("ator") and pid in nmap:
                        ev["ator"] = nmap[pid].get("full_name")
                        if not ev.get("ator_role"): ev["ator_role"] = nmap[pid].get("role")
            except Exception as e:
                print(f"[auditoria] resolve nomes: {e}")

        # Filtros
        if etapa:
            eventos = [e for e in eventos if (e.get("etapa") or "").lower().startswith(etapa.lower())]
        if condo_id:
            eventos = [e for e in eventos if e.get("condominio_id") == condo_id]
        if gerente_id:
            eventos = [e for e in eventos if e.get("gerente_id") == gerente_id]
        if search:
            s = search.lower()
            eventos = [e for e in eventos if
                s in (e.get("acao") or "").lower() or s in (e.get("ator") or "").lower() or
                s in (e.get("condominio_nome") or "").lower() or s in (e.get("motivo") or "").lower() or
                s in (e.get("arquivo_nome") or "").lower()]

        eventos.sort(key=lambda e: e.get("quando") or "", reverse=True)
        total = len(eventos)
        page = eventos[offset: offset + limit]

        import datetime
        hoje = datetime.date.today().isoformat()
        hoje_count = sum(1 for e in eventos if (e.get("quando") or "")[:10] == hoje)

        return {"logs": page, "total": total, "hoje": hoje_count}
    except HTTPException:
        raise
    except Exception as e:
        print(f"CRITICAL ERROR /auditoria: {e}")
        return {"logs": [], "total": 0, "hoje": 0, "error": str(e)}


@router.get("/auditoria/erros")
def api_auditoria_erros(
    date_from: str = None,
    date_to: str = None,
    search: str = None,
    limit: int = 80,
    offset: int = 0,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db),
):
    """Aba 'Erros' da auditoria: quebras de código (exceções 500) capturadas no backend."""
    try:
        if user["role"] not in VIEW_AUDITORIA:
            raise HTTPException(403, "Acesso negado")
        q = db.table("audit_erros").select("*", count="exact").order("criado_em", desc=True)
        if date_from:
            q = q.gte("criado_em", date_from)
        if date_to:
            q = q.lte("criado_em", date_to + "T23:59:59")
        if search:
            q = q.or_(f"mensagem.ilike.%{search}%,rota.ilike.%{search}%")
        res = q.range(offset, offset + limit - 1).execute()
        rows = res.data or []
        import datetime
        hoje = datetime.date.today().isoformat()
        hoje_res = db.table("audit_erros").select("id", count="exact", head=True).gte("criado_em", hoje).execute()
        return {"erros": rows, "total": res.count or len(rows), "hoje": hoje_res.count or 0}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[auditoria/erros] {e}")
        return {"erros": [], "total": 0, "hoje": 0, "error": str(e)}


class RateioUpdate(BaseModel):
    ano: int
    obs_emissao: str
    rateios: list
    rateios_vals: dict

@router.post("/condominio/{condo_id}/arrecadacoes/salvar")
def api_salvar_arrecadacoes(condo_id: str, data: RateioUpdate, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        # Aqui vai a lógica de salvar os rateios_config e rateios_valores, além do obs_emissao
        db.table("condominios").update({"obs_emissao": data.obs_emissao}).eq("id", condo_id).execute()
        
        for rat in data.rateios:
            rid = rat.get("id")
            payload = {k: v for k, v in rat.items() if k != "id"}
            payload["condominio_id"] = condo_id
            
            if str(rid).startswith("new_"):
                res = db.table("rateios_config").insert(payload).execute()
                if res.data:
                    rid = res.data[0]["id"]
            else:
                db.table("rateios_config").update(payload).eq("id", rid).execute()
                
            # Salva os valores mensais
            vals = data.rateios_vals.get(str(rid), {}) if str(rid) in data.rateios_vals else data.rateios_vals.get(rid, {})
            for mes, valor in vals.items():
                db.table("rateios_valores").upsert({
                    "rateio_id": rid,
                    "ano": data.ano,
                    "month": int(mes),
                    "valor": str(valor)
                }).execute()

        return {"success": True}
    except Exception as e:
        raise HTTPException(400, str(e))

@router.get("/condominio/{condo_id}/arrecadacoes")
def api_get_arrecadacoes(condo_id: str, ano: int, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        from datetime import datetime
        sem = 1 if datetime.now().month <= 6 else 2
        
        condo = db.table("condominios").select("*").eq("id", condo_id).single().execute().data
        
        # Processo do semestre
        p_res = db.table("processos").select("*").eq("condominio_id", condo_id).eq("year", ano).eq("semester", sem).execute()
        processo = p_res.data[0] if p_res.data else None
        
        # Obter rateios
        rateios = db.table("rateios_config").select("*").eq("condominio_id", condo_id).order("ordem").execute().data
        
        rateios_vals = {}
        if rateios:
            r_ids = [r["id"] for r in rateios]
            vals = db.table("rateios_valores").select("*").in_("rateio_id", r_ids).eq("ano", ano).execute().data
            for v in vals:
                if v["rateio_id"] not in rateios_vals:
                    rateios_vals[v["rateio_id"]] = {}
                rateios_vals[v["rateio_id"]][v["month"]] = v["valor"]
                
        # Grupos de emissão (0086). Um condomínio comum tem só o "Geral" e a tela
        # nem desenha a faixa; os 27 com dois vencimentos têm dois.
        try:
            grupos = db.table("condominio_grupos").select("id, nome, due_day, ordem") \
                .eq("condominio_id", condo_id).eq("ativo", True).order("ordem").execute().data or []
        except Exception as e:
            print(f"[arrecadacoes] grupos indisponíveis: {type(e).__name__}: {e}")
            grupos = []   # 0086 ainda não aplicada — a tela cai no modo antigo

        return {"condo": condo, "processo": processo, "rateios": rateios,
                "rateios_vals": rateios_vals, "grupos": grupos}
    except Exception as e:
        raise HTTPException(500, str(e))


# ─── Preencher consumos (água/gás/energia) na planilha a partir dos anexos da emissão ───
def _norm_txt(s):
    import unicodedata
    return ''.join(c for c in unicodedata.normalize('NFD', (s or '')) if unicodedata.category(c) != 'Mn').upper()

def _servico_rateio(nome):
    n = _norm_txt(nome)
    if 'AGUA' in n: return 'agua'
    if 'GAS' in n: return 'gas'
    if 'ENERGIA' in n or 'ELETRIC' in n or 'LUZ' in n or 'ENEL' in n: return 'energia'
    return None

def _consumos_do_pacote(db: Client, pacote_id: str, detalhe: bool = False):
    """Valor por serviço a partir dos anexos do pacote: relatório de leitura tem
    prioridade; se não houver, usa a conta da concessionária (SABESP/COMGÁS/ENEL).

    Um condomínio pode ter MAIS DE UMA conta do mesmo serviço no mês — duas
    instalações de água, por exemplo. Os valores somam, e é por isso que tirar um
    anexo baixa o total: a conta é sempre refeita a partir do que está anexado
    AGORA, nunca de um número guardado.

    Com `detalhe=True` devolve também de onde cada total veio, para a tela poder
    dizer "soma de 2 contas" em vez de só mostrar um número maior."""
    arqs = db.table("emissoes_arquivos").select(
        "arquivo_nome, categoria, subtipo, relatorio_tipo_servico, relatorio_valor_total, valor_fatura"
    ).eq("pacote_id", pacote_id).execute().data or []
    rel = {'agua': 0.0, 'gas': 0.0, 'energia': 0.0}
    fat = {'agua': 0.0, 'gas': 0.0, 'energia': 0.0}
    origem = {'agua': [], 'gas': [], 'energia': []}   # [{nome, valor, tipo}]
    for a in arqs:
        cat = a.get('categoria')
        if cat == 'relatorio_leitura':
            ts = _norm_txt(a.get('relatorio_tipo_servico'))
            v = float(a.get('relatorio_valor_total') or 0)
            # Mesma regra de _servico_do_arquivo: energia tem verba própria e
            # não pode cair em água.
            serv = 'gas' if 'GAS' in ts else ('energia' if ('ENERGIA' in ts or 'ELETRIC' in ts or 'LUZ' in ts) else 'agua')
            rel[serv] += v
            if v: origem[serv].append({"nome": a.get('arquivo_nome'), "valor": v, "tipo": "relatorio"})
        elif cat == 'concessionaria':
            st = _norm_txt(a.get('subtipo'))
            v = float(a.get('valor_fatura') or 0)
            serv = None
            if 'SABESP' in st: serv = 'agua'
            elif 'COMGAS' in st: serv = 'gas'
            elif 'ENEL' in st or 'ELETROPAULO' in st or 'ENERGIA' in st: serv = 'energia'
            if serv:
                fat[serv] += v
                if v: origem[serv].append({"nome": a.get('arquivo_nome'), "valor": v, "tipo": "fatura"})
    totais = {s: round(rel[s] if rel[s] > 0 else fat[s], 2) for s in ('agua', 'gas', 'energia')}
    if not detalhe:
        return totais
    # Só interessa a origem que de fato formou o total: se há relatório, a conta
    # da concessionária não entrou na soma e citá-la confundiria.
    usadas = {s: [o for o in origem[s] if o["tipo"] == ("relatorio" if rel[s] > 0 else "fatura")]
              for s in ('agua', 'gas', 'energia')}
    return totais, usadas

@router.get("/condominio/{condo_id}/consumos-planilha")
def api_consumos_planilha_preview(condo_id: str, pacote_id: str, mes: int, ano: int,
                                  user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    if user.get("role") not in ("master", "departamento"):
        raise HTTPException(403, "Apenas master/emissor")
    # O CASO QUE OBRIGOU A MUDANCA
    #
    # Um condominio pode ter duas contas do MESMO servico, em instalacoes
    # diferentes: o gas do predio e o gas da piscina, cada um com a sua verba.
    # O codigo antigo resolvia a verba pelo NOME ('GAS' in nome -> 'gas') e
    # devolvia um total por servico — entao as duas verbas recebiam a SOMA das
    # duas contas. Aconteceu no 0302: R$ 9.909,45 do bloco e R$ 1.387,42 da
    # piscina viraram o mesmo numero nas duas linhas.
    #
    # Agora cada anexo carrega a sua verba (emissoes_arquivos.rateio_id, 0100).
    # Servico com UMA verba so — a maioria — nao muda: nao ha escolha a fazer.
    # Com duas ou mais, cada conta precisa de dono, e as sem dono voltam em
    # `sem_verba` para a tela perguntar.
    rateios = db.table("rateios_config").select("id, nome, ordem").eq("condominio_id", condo_id).order("ordem").execute().data or []
    r_ids = [r["id"] for r in rateios]
    atuais = {}
    if r_ids:
        vals = db.table("rateios_valores").select("rateio_id, valor").in_("rateio_id", r_ids).eq("month", int(mes)).eq("ano", int(ano)).execute().data or []
        for v in vals:
            atuais[v["rateio_id"]] = float(v.get("valor") or 0)

    verbas_do_servico = {}
    for r in rateios:
        serv = _servico_rateio(r["nome"])
        if serv:
            verbas_do_servico.setdefault(serv, []).append(r)

    arqs = db.table("emissoes_arquivos").select(
        "id, arquivo_nome, categoria, subtipo, relatorio_tipo_servico, "
        "relatorio_valor_total, valor_fatura, instalacao, rateio_id"
    ).eq("pacote_id", pacote_id).execute().data or []

    def _servico_do_arquivo(a):
        if a.get("categoria") == "relatorio_leitura":
            # Era `gas se tiver "gas", senao agua` — um relatorio de ENERGIA
            # caia em agua e o valor ia para a verba errada, calado. Condominio
            # com "consumo de energia (nr)" mostra isso na hora.
            ts = _norm_txt(a.get("relatorio_tipo_servico"))
            if "GAS" in ts:
                return "gas"
            if "ENERGIA" in ts or "ELETRIC" in ts or "LUZ" in ts:
                return "energia"
            return "agua"
        st = _norm_txt(a.get("subtipo"))
        if "SABESP" in st:
            return "agua"
        if "COMGAS" in st:
            return "gas"
        if "ENEL" in st or "ELETROPAULO" in st or "ENERGIA" in st:
            return "energia"
        return None

    # Sugestao herdada: instalacao -> verba escolhida no mes anterior. Ninguem
    # deveria responder a mesma pergunta todo mes.
    mes_ant, ano_ant = (12, int(ano) - 1) if int(mes) == 1 else (int(mes) - 1, int(ano))
    heranca = {}
    try:
        antigos = db.table("emissoes_arquivos").select("instalacao, rateio_id") \
            .eq("condominio_id", condo_id).eq("mes_referencia", mes_ant) \
            .eq("ano_referencia", ano_ant).not_.is_("rateio_id", "null").execute().data or []
        for a in antigos:
            if a.get("instalacao"):
                heranca[str(a["instalacao"])] = a["rateio_id"]
    except Exception as e:
        print("[consumos-planilha] heranca indisponivel: %s" % e)

    por_verba = {}
    sem_verba = []
    for a in arqs:
        serv = _servico_do_arquivo(a)
        if not serv:
            continue
        valor = a.get("relatorio_valor_total") if a.get("categoria") == "relatorio_leitura" else a.get("valor_fatura")
        if valor is None:
            continue
        verbas = verbas_do_servico.get(serv, [])
        if not verbas:
            continue

        conta = {
            "arquivo_id": a["id"], "nome": a.get("arquivo_nome"), "valor": float(valor),
            "instalacao": a.get("instalacao"), "servico": serv,
            "tipo": "relatorio" if a.get("categoria") == "relatorio_leitura" else "fatura",
        }

        alvo = a.get("rateio_id") or heranca.get(str(a.get("instalacao") or ""))
        if len(verbas) == 1:
            alvo = verbas[0]["id"]
        if alvo and any(v["id"] == alvo for v in verbas):
            conta["herdado"] = not a.get("rateio_id")
            por_verba.setdefault(alvo, []).append(conta)
        else:
            sem_verba.append(conta)

    linhas = []
    for serv, verbas in verbas_do_servico.items():
        for r in verbas:
            contas = por_verba.get(r["id"], [])
            if not contas:
                continue
            # Relatorio de leitura manda sobre a fatura: sao o MESMO gasto visto
            # de dois jeitos, e somar os dois conta o mes em dobro.
            rel = [c for c in contas if c["tipo"] == "relatorio"]
            usadas = rel if rel else contas
            linhas.append({
                "rateio_id": r["id"], "nome": r["nome"], "servico": serv,
                "atual": atuais.get(r["id"], 0),
                "novo": round(sum(c["valor"] for c in usadas), 2),
                "contas": usadas,
                "escolha_possivel": len(verbas) > 1,
            })

    return {
        "linhas": linhas,
        "sem_verba": sem_verba,
        "verbas": [{"rateio_id": r["id"], "nome": r["nome"], "servico": s}
                   for s, vs in verbas_do_servico.items() for r in vs],
    }

class PreencherConsumosBody(BaseModel):
    mes: int
    ano: int
    itens: list
    # [{arquivo_id, rateio_id}] — de qual verba e cada conta. Guardado no anexo
    # para a fatura do mes seguinte, na mesma instalacao, herdar a escolha.
    atribuicoes: Optional[list] = None

@router.post("/condominio/{condo_id}/consumos-planilha")
def api_consumos_planilha_aplicar(condo_id: str, data: PreencherConsumosBody,
                                  user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    if user.get("role") not in ("master", "departamento"):
        raise HTTPException(403, "Apenas master/emissor")
    aplicados = 0
    for it in (data.itens or []):
        rid = it.get("rateio_id")
        if not rid:
            continue
        valor = float(it.get("valor") or 0)
        existing = db.table("rateios_valores").select("id").eq("rateio_id", rid).eq("month", int(data.mes)).eq("ano", int(data.ano)).maybe_single().execute()
        if existing.data:
            db.table("rateios_valores").update({"valor": valor}).eq("id", existing.data["id"]).execute()
        else:
            db.table("rateios_valores").insert({"rateio_id": rid, "month": int(data.mes), "ano": int(data.ano), "valor": valor}).execute()
        aplicados += 1

    for at in (data.atribuicoes or []):
        aid, rid = at.get("arquivo_id"), at.get("rateio_id")
        if aid and rid:
            try:
                db.table("emissoes_arquivos").update({"rateio_id": rid}).eq("id", aid).execute()
            except Exception as e:
                print("[consumos-planilha] atribuicao %s: %s" % (aid, e))

    return {"ok": True, "aplicados": aplicados}


@router.get("/condominio/{condo_id}/ultima-emissao")
def api_ultima_emissao(condo_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        # Busca o arquivo mais recente deste condomínio
        res = db.table("emissoes_arquivos").select("*").eq("condominio_id", condo_id).order("criado_em", desc=True).limit(1).execute()
        
        if not res.data:
            return {"file": None}
            
        file_data = res.data[0]
        
        # Gera Signed URL
        signed_res = db.storage.from_('emissoes').create_signed_url(file_data["arquivo_url"], 300)
        
        # A lib do Supabase às vezes retorna dict ou string dependendo da implementação/mock
        url = signed_res.get("signedURL") if isinstance(signed_res, dict) else signed_res
        
        return {
            "file": {
                "id": file_data["id"],
                "name": file_data["arquivo_nome"],
                "format": file_data["formato"],
                "url": url,
                "status": file_data["status"]
            }
        }
    except Exception as e:
        print(f"Error /ultima-emissao: {e}")
        return {"file": None, "error": str(e)}

@router.get("/usuarios")
def api_usuarios(user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    if user["role"] != "master":
        raise HTTPException(403)
    usuarios = db.table("profiles").select("*").order("full_name").execute().data or []

    # A situacao do gerente vem junto (0104).
    #
    # `profiles` diz o papel; `gerentes` diz se a pessoa esta na operacao — e
    # sao tabelas diferentes. Sem juntar aqui, a tela de Acessos e Perfis nao
    # tem como mostrar nem mudar o ativo/inativo, e o campo so existiria por
    # SQL. Campo que so existe por SQL nao existe.
    try:
        gs = db.table("gerentes").select(
            "id, profile_id, ativo, ativo_desde, inativado_em, inativado_motivo").execute().data or []
        por_profile = {g["profile_id"]: g for g in gs if g.get("profile_id")}

        # Quantos condominios cada um carrega, e quantos deles estao na
        # operacao. Inativar quem tem carteira viva e diferente de inativar quem
        # so tem cadastro esperando entrar — a tela precisa dizer qual e qual.
        condos = db.table("condominios").select("gerente_id, situacao").execute().data or []
        total, ativos = {}, {}
        for c in condos:
            gid = c.get("gerente_id")
            if not gid:
                continue
            total[gid] = total.get(gid, 0) + 1
            if c.get("situacao") == "ativo":
                ativos[gid] = ativos.get(gid, 0) + 1

        for u in usuarios:
            g = por_profile.get(u["id"])
            if not g:
                continue
            u["gerente_id_real"] = g["id"]
            u["gerente_ativo"] = g.get("ativo") is not False
            u["gerente_ativo_desde"] = g.get("ativo_desde")
            u["gerente_inativado_motivo"] = g.get("inativado_motivo")
            u["condominios_total"] = total.get(g["id"], 0)
            u["condominios_em_operacao"] = ativos.get(g["id"], 0)
    except Exception as e:
        print(f"[usuarios] situacao do gerente falhou (segue sem): {e}")

    return {"usuarios": usuarios}




class ForceStatusSchema(BaseModel):
    status: str
    year: int = None

@router.post("/condominio/{condo_id}/processo/force")
def api_condo_process_status_force(condo_id: str, data: ForceStatusSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        if user["role"] not in ROLES_EMISSORES:
            raise HTTPException(403, "Apenas emissor ou master podem forçar o status")
            
        import datetime
        now = datetime.datetime.now()
        ano = data.year or now.year
        sem = 1 if now.month <= 6 else 2
        
        # Check if process exists
        proc_res = db.table("processos").select("*").eq("condominio_id", condo_id).eq("year", ano).eq("semester", sem).execute()
        
        if not proc_res.data:
            # Create process
            new_proc = db.table("processos").insert({
                "condominio_id": condo_id,
                "year": ano,
                "semester": sem,
                "status": data.status
            }).execute()
            processo_id = new_proc.data[0]["id"]
        else:
            # Update process
            processo_id = proc_res.data[0]["id"]
            db.table("processos").update({
                "status": data.status
            }).eq("id", processo_id).execute()
        
        # Log action
        db.table("aprovacoes").insert({
            "processo_id": processo_id,
            "approver_id": user["id"],
            "action": f"Status forçado para: {data.status} (Início s/ rascunho)",
            "comment": "Timeline acionada pelo Emissor"
        }).execute()
        
        # Return the updated/created process
        final_proc = db.table("processos").select("*").eq("id", processo_id).single().execute()
        return {"success": True, "processo": final_proc.data}
    except Exception as e:
        print("ERROR forcing status:", e)
        raise HTTPException(400, str(e))

@router.post("/processo/{processo_id}/status/force")
def api_processo_status_force(processo_id: str, data: ForceStatusSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        if user["role"] not in ROLES_EMISSORES:
            raise HTTPException(403, "Apenas emissor ou master podem forçar o status")
        
        proc_res = db.table("processos").select("*").eq("id", processo_id).single().execute()
        if not proc_res.data:
            raise HTTPException(404, "Processo não encontrado")
            
        db.table("processos").update({
            "status": data.status
        }).eq("id", processo_id).execute()
        
        # Log action
        db.table("aprovacoes").insert({
            "processo_id": processo_id,
            "approver_id": user["id"],
            "action": f"Status alterado para: {data.status}",
            "comment": "Alteração manual pelo Emissor"
        }).execute()
        
        return {"success": True, "new_status": data.status}
    except Exception as e:
        raise HTTPException(400, str(e))

class PipelineForceAllSchema(BaseModel):
    status: str
    ano: int = None
    semestre: int = None
    gerente_id: str = None
    condominio_id: str = None   # 1-a-1: aplica só a este condomínio

@router.post("/pipeline/force-all")
def api_pipeline_force_all(data: PipelineForceAllSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        if user["role"] != "master":
            raise HTTPException(403, "Apenas master pode forçar status global")

        import datetime
        now = datetime.datetime.now()
        ano = data.ano or now.year
        sem = data.semestre or (1 if now.month <= 6 else 2)

        # Buscar condomínios (todos, por gerente, ou 1-a-1 por condomínio)
        query = db.table("condominios").select("id")
        if data.condominio_id:
            query = query.eq("id", data.condominio_id)
        elif data.gerente_id:
            # O front manda o id do PROFILE; condominios.gerente_id é gerentes.id -> resolve
            g_real = get_gerente_id(db, data.gerente_id) or data.gerente_id
            query = query.eq("gerente_id", g_real)
        condos_res = query.execute()
        condos = condos_res.data or []

        updated = 0
        for condo in condos:
            condo_id = condo["id"]
            # Verificar se já existe processo para este condo/ano/semestre
            proc_res = db.table("processos").select("id").eq("condominio_id", condo_id).eq("year", ano).eq("semester", sem).execute()

            if not proc_res.data:
                # Criar processo novo
                new_proc = db.table("processos").insert({
                    "condominio_id": condo_id,
                    "year": ano,
                    "semester": sem,
                    "status": data.status
                }).execute()
                processo_id = new_proc.data[0]["id"] if new_proc.data else None
            else:
                processo_id = proc_res.data[0]["id"]
                db.table("processos").update({"status": data.status}).eq("id", processo_id).execute()

            if processo_id:
                try:
                    db.table("aprovacoes").insert({
                        "processo_id": processo_id,
                        "approver_id": user["id"],
                        "action": f"Status forçado globalmente para: {data.status}",
                        "comment": "Painel de Controle Global — master"
                    }).execute()
                except Exception:
                    pass
                updated += 1

        return {"success": True, "updated": updated}
    except HTTPException:
        raise
    except Exception as e:
        print("ERROR pipeline force-all:", e)
        raise HTTPException(400, str(e))


class CreateUserSchema(BaseModel):
    email: str
    password: str
    full_name: str
    role: str
    gerente_id: Optional[str] = None  # profile do gerente responsável (quando role=assistente)
    enviar_email: bool = False        # se True, envia o e-mail de acesso AGORA (não é automático)

@router.post("/usuarios")
def api_criar_usuario(data: CreateUserSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    if user["role"] != "master":
        raise HTTPException(403, "Apenas administradores podem criar usuários")
    
    if not SB_SERVICE:
        raise HTTPException(500, "SUPABASE_SERVICE_KEY não configurada no servidor. Contate o suporte.")

    try:
        # 1. Tentar criar no Auth usando admin
        uid = None
        try:
            # Verifica se o admin client está disponível
            if not hasattr(db.auth, 'admin') or db.auth.admin is None:
                raise Exception("SDK Admin não inicializado corretamente. Verifique a SERVICE_KEY.")

            auth_res = db.auth.admin.create_user({
                "email": data.email,
                "password": data.password,
                "email_confirm": True
            })
            
            if hasattr(auth_res, 'user') and auth_res.user:
                uid = str(auth_res.user.id)
            else:
                raise Exception("A resposta do Supabase não conteve os dados do usuário criado.")

        except Exception as auth_e:
            err_msg = str(auth_e)
            if "already" in err_msg.lower() or "registered" in err_msg.lower():
                try:
                    users = db.auth.admin.list_users()
                    user_list = users if isinstance(users, list) else getattr(users, 'users', [])
                    target = next((u for u in user_list if u.email == data.email), None)
                    if target:
                        uid = str(target.id)
                    else:
                        raise Exception(f"Usuário já existe mas não pôde ser localizado: {err_msg}")
                except:
                    raise Exception(f"O e-mail {data.email} já está em uso.")
            else:
                raise Exception(f"Erro no Supabase Auth: {err_msg}")

        if not uid:
            raise Exception("Não foi possível gerar ou recuperar o ID do usuário.")

        # 2. Criar ou Atualizar no Profiles (senha temporária — forçar troca no 1º acesso)
        profile_payload = {
            "id": uid,
            "email": data.email,
            "full_name": data.full_name,
            "role": data.role,
            "must_change_password": True,
        }
        if data.role == 'assistente':
            profile_payload["gerente_id"] = data.gerente_id or None
        db.table("profiles").upsert(profile_payload).execute()

        # 3. Se for gerente: tentar vincular a um gerente-fantasma existente
        # (importado do Ahreas com nome igual mas sem profile_id ainda).
        # Caso não exista, cria novo gerente.
        if data.role == 'gerente':
            ghost = db.table("gerentes").select("id").is_("profile_id", "null") \
                .ilike("nome", data.full_name).limit(1).execute().data
            if ghost:
                db.table("gerentes").update({"profile_id": uid, "nome": data.full_name}) \
                    .eq("id", ghost[0]["id"]).execute()
            else:
                db.table("gerentes").upsert(
                    {"profile_id": uid, "nome": data.full_name},
                    on_conflict="profile_id"
                ).execute()

        # 4. E-mail de acesso — só se o admin pediu (NÃO é automático)
        email_enviado = False
        if data.enviar_email:
            email_enviado = _enviar_email_acesso(db, data.email, data.full_name, data.password)

        return {"success": True, "uid": uid, "email_enviado": email_enviado}

    except Exception as e:
        print(f"CRITICAL ERROR CREATE_USER: {e}")
        raise HTTPException(status_code=400, detail=str(e))

class VincularGerenteSchema(BaseModel):
    assistente_id: str            # profile do assistente
    gerente_id: Optional[str] = None  # profile do gerente (None = desvincular)

@router.post("/usuarios/vincular-gerente")
def api_vincular_gerente(data: VincularGerenteSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    if user["role"] != "master":
        raise HTTPException(403, "Apenas administradores")
    db.table("profiles").update({"gerente_id": data.gerente_id or None}).eq("id", data.assistente_id).execute()
    return {"success": True}

class SyncUserSchema(BaseModel):
    email: str
    password: str
    full_name: str
    role: str
    profile_id: Optional[str] = None

@router.post("/usuarios/sync")
def api_sync_usuario(data: SyncUserSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Repara ou Reseta um usuário existente (como o Diogo)"""
    if user["role"] != "master":
        raise HTTPException(403)
    
    if not SB_SERVICE:
        raise HTTPException(500, "Service Key não configurada")

    try:
        # Tenta criar no Auth (pode falhar se já existir, mas o admin.create_user costuma dar erro se duplicado)
        # O objetivo aqui é garantir que existe no Auth e Profile com o mesmo e-mail
        
        uid = data.profile_id
        
        # Se não temos UID ou queremos garantir que o e-mail no Auth está OK
        try:
            # Cria novo no auth. Se der erro de duplicidade, o catch pega.
            auth_res = db.auth.admin.create_user({
                "email": data.email,
                "password": data.password,
                "email_confirm": True
            })
            uid = auth_res.user.id
        except Exception as auth_err:
            # Provavelmente já existe no Auth. Vamos tentar atualizar a senha.
            # Nota: No Supabase Admin Python, não é trivial resetar sem o UID.
            # Mas podemos buscar o usuário pelo email primeiro.
            users_list = db.auth.admin.list_users() # Cuidado: Paginado
            users_iter = users_list if isinstance(users_list, list) else getattr(users_list, 'users', [])
            target_user = next((u for u in users_iter if u.email == data.email), None)
            
            if target_user:
                uid = target_user.id
                db.auth.admin.update_user_by_id(uid, {"password": data.password})
            else:
                raise auth_err

        # Agora garantimos que o Profile aponta para este UID
        # Se o perfil antigo tinha outro ID (ex: uuid gerado manualmente no seed), deletamos o antigo e criamos novo
        if data.profile_id and data.profile_id != uid:
            db.table("profiles").delete().eq("id", data.profile_id).execute()

        db.table("profiles").upsert({
            "id": uid,
            "email": data.email,
            "full_name": data.full_name,
            "role": data.role
        }).execute()

        if data.role == "gerente":
            db.table("gerentes").upsert({"profile_id": uid}, on_conflict="profile_id").execute()

        return {"success": True, "id": uid}
    except Exception as e:
        raise HTTPException(400, str(e))

# ═══ GESTÃO DE SENHAS ═══════════════════════════════════════════════════

class AdminResetPasswordSchema(BaseModel):
    new_password: str
    force_change: bool = True   # se True, marca must_change_password=true
    enviar_email: bool = False  # se True, envia os dados de acesso por e-mail ao usuário

@router.post("/usuarios/{profile_id}/reset-password")
def api_admin_reset_password(profile_id: str, data: AdminResetPasswordSchema,
                              user: dict = Depends(get_current_user),
                              db: Client = Depends(get_db)):
    """Master define uma nova senha para qualquer usuário (saída de funcionário, esqueci, etc)."""
    if user["role"] != "master":
        raise HTTPException(403, "Apenas administradores podem resetar senhas de terceiros")
    if not SB_SERVICE:
        raise HTTPException(500, "Service Key não configurada")
    if not data.new_password or len(data.new_password) < 6:
        raise HTTPException(400, "Senha deve ter no mínimo 6 caracteres")

    try:
        # 1. Atualiza senha no Supabase Auth (Admin API)
        db.auth.admin.update_user_by_id(profile_id, {"password": data.new_password})

        # 2. Marca para troca obrigatória no proximo login (recomendado)
        db.table("profiles").update({
            "must_change_password": bool(data.force_change),
            "password_changed_at": __import__('datetime').datetime.utcnow().isoformat() if not data.force_change else None,
        }).eq("id", profile_id).execute()

        # 3. Opcional: envia os dados de acesso por e-mail (o admin decide na hora)
        email_enviado = False
        if data.enviar_email:
            prof = db.table("profiles").select("email, full_name").eq("id", profile_id).maybe_single().execute().data
            if prof and prof.get("email"):
                email_enviado = _enviar_email_acesso(db, prof["email"], prof.get("full_name") or "", data.new_password)

        return {"success": True, "email_enviado": email_enviado}
    except Exception as e:
        print(f"[reset-password] erro: {e}")
        raise HTTPException(400, str(e))


class ChangeOwnPasswordSchema(BaseModel):
    new_password: str

@router.post("/auth/change-password")
def api_change_own_password(data: ChangeOwnPasswordSchema,
                            user: dict = Depends(get_current_user),
                            db: Client = Depends(get_db)):
    """Usuario autenticado troca a propria senha. Limpa o flag must_change_password."""
    if not data.new_password or len(data.new_password) < 6:
        raise HTTPException(400, "Senha deve ter no mínimo 6 caracteres")
    if not SB_SERVICE:
        raise HTTPException(500, "Service Key não configurada")

    try:
        import datetime as _dt
        db.auth.admin.update_user_by_id(user["id"], {"password": data.new_password})
        db.table("profiles").update({
            "must_change_password": False,
            "password_changed_at": _dt.datetime.utcnow().isoformat(),
        }).eq("id", user["id"]).execute()
        _user_cache.clear()  # senha/flag mudou — não servir user cacheado
        return {"success": True}
    except Exception as e:
        print(f"[change-password] erro: {e}")
        raise HTTPException(400, str(e))


@router.delete("/usuarios/{profile_id}")
def api_deletar_usuario(profile_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Deleta um usuário do Auth e do Profile (cascade)"""
    if user["role"] != "master":
        raise HTTPException(403, "Apenas administradores podem excluir usuários")
    
    if not SB_SERVICE:
        raise HTTPException(500, "Service Key não configurada")

    try:
        # 1. Deletar no Auth (isso vai disparar o ON DELETE CASCADE no profile e gerente)
        db.auth.admin.delete_user(profile_id)
        
        # 2. Por segurança, garantir que o profile foi removido (caso o cascade falhe ou demore)
        db.table("profiles").delete().eq("id", profile_id).execute()

        return {"success": True}
    except Exception as e:
        print(f"Erro ao deletar usuário: {e}")
        raise HTTPException(400, str(e))


# ═══ GERENCIAMENTO DE CARTEIRAS ═══════════════════════════════════════

@router.get("/usuarios/{profile_id}/carteiras")
def api_get_carteiras_gerente(profile_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Retorna os condomínios vinculados a um gerente específico."""
    if user["role"] != "master":
        raise HTTPException(403, "Acesso negado")
    
    # Busca o gerente_id a partir do profile_id
    gerente_res = db.table("gerentes").select("id").eq("profile_id", profile_id).execute()
    if not gerente_res.data:
        return {"condominios_vinculados": [], "condominios_disponiveis": []}
    
    gerente_id = gerente_res.data[0]["id"]
    
    # Condomínios vinculados ao gerente
    vinculados_res = db.table("condominios").select("id, name").eq("gerente_id", gerente_id).order("name").execute()
    
    # Todos condomínios sem gerente (disponíveis para vincular)
    disponiveis_res = db.table("condominios").select("id, name").is_("gerente_id", "null").order("name").execute()
    
    return {
        "gerente_id": gerente_id,
        "condominios_vinculados": vinculados_res.data or [],
        "condominios_disponiveis": disponiveis_res.data or []
    }


class VincularCondoSchema(BaseModel):
    gerente_id: str
    condominio_id: str

@router.post("/usuarios/vincular-condo")
def api_vincular_condo(data: VincularCondoSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Vincula um condomínio a um gerente."""
    if user["role"] != "master":
        raise HTTPException(403, "Acesso negado")
    try:
        db.table("condominios").update({"gerente_id": data.gerente_id}).eq("id", data.condominio_id).execute()
        return {"success": True}
    except Exception as e:
        raise HTTPException(400, str(e))


class DesvincularCondoSchema(BaseModel):
    condominio_id: str

@router.post("/usuarios/desvincular-condo")
def api_desvincular_condo(data: DesvincularCondoSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Remove o vínculo de um condomínio com qualquer gerente."""
    if user["role"] != "master":
        raise HTTPException(403, "Acesso negado")
    try:
        db.table("condominios").update({"gerente_id": None}).eq("id", data.condominio_id).execute()
        return {"success": True}
    except Exception as e:
        raise HTTPException(400, str(e))


@router.get("/usuarios/lista-completa")
def api_usuarios_completo(user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Retorna todos os usuários com seus condomínios vinculados (para o painel master)."""
    if user["role"] != "master":
        raise HTTPException(403, "Acesso negado")
    
    # Profiles com dados do gerente
    profiles = db.table("profiles").select("*").order("full_name").execute().data or []
    
    # Gerentes com seus condomínios
    gerentes_res = db.table("gerentes").select("id, profile_id, condominios(id, name)").execute().data or []
    gerentes_map = {g["profile_id"]: g for g in gerentes_res}
    
    result = []
    for p in profiles:
        g = gerentes_map.get(p["id"])
        result.append({
            **p,
            "gerente_id": g["id"] if g else None,                 # gerentes.id (carteira própria, se for gerente)
            "gerente_responsavel_id": p.get("gerente_id"),        # profile do gerente responsável (se for assistente)
            "condominios": g["condominios"] if g else []
        })
    
    return {"usuarios": result}


class NotificacaoEmailSchema(BaseModel):
    notificacao_email: Optional[str] = None

@router.post("/usuarios/{profile_id}/notificacao-email")
def api_set_notificacao_email(profile_id: str, data: NotificacaoEmailSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Define o e-mail para onde vão as notificações deste usuário (vazio = usa o e-mail de login)."""
    if user["role"] != "master":
        raise HTTPException(403, "Acesso negado")
    val = (data.notificacao_email or "").strip() or None
    db.table("profiles").update({"notificacao_email": val}).eq("id", profile_id).execute()
    return {"success": True}

# ═══════════════════════════════════════════════════════════════════════
# CondoFlow — Novas rotas RBAC + Conferência
# ═══════════════════════════════════════════════════════════════════════

from datetime import datetime
import hashlib

MESES_PT = {
    1: 'Jan', 2: 'Fev', 3: 'Mar', 4: 'Abr', 5: 'Mai', 6: 'Jun',
    7: 'Jul', 8: 'Ago', 9: 'Set', 10: 'Out', 11: 'Nov', 12: 'Dez'
}

# ═══ RBAC helpers ═════════════════════════════════════════════════════

# NOTE: listas mantidas como aliases para compatibilidade — fonte da verdade em auth_constants.py
ROLES_APROVADORES = APPROVE_DOCUMENT  # inclui supervisor_gerentes
ROLES_EMISSORES = EMIT_DOCUMENT       # ['master', 'departamento']
ROLES_LANCA_COBRANCAS = EDIT_COBRANCAS_EXTRAS


def require_role(user: dict, roles: list):
    """Levanta 403 se o usuario nao tiver um dos roles permitidos."""
    if user.get('role') not in roles:
        raise HTTPException(403, f"Acesso negado. Requer role: {', '.join(roles)}")


# ═══ Endpoint: Dados de conferência (Planilha + Cobranças) ════════════

@router.get("/condominio/{condo_id}/conferencia")
def api_dados_conferencia(condo_id: str, request: Request, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    import traceback
    from datetime import datetime

    MESES_PT = {1:'Jan',2:'Fev',3:'Mar',4:'Abr',5:'Mai',6:'Jun',
                7:'Jul',8:'Ago',9:'Set',10:'Out',11:'Nov',12:'Dez'}

    def parse_valor(v) -> float:
        if v is None: return 0.0
        s = str(v).strip().replace('R$','').replace(' ','')
        if s in ('','PLANILHA','-','—'): return 0.0
        if ',' in s:
            s = s.replace('.','').replace(',','.')
        else:
            parts = s.split('.')
            if len(parts) > 2:
                s = ''.join(parts[:-1]) + '.' + parts[-1]
        try: return float(s)
        except: return 0.0

    year = datetime.now().year
    meses = [{'mes':m,'mes_nome':MESES_PT[m],'condominio':0.0,'fundo_reserva':0.0,'total':0.0} for m in range(1,13)]
    total_condo = total_fundo = total_geral = 0.0
    # Definidos ANTES do try: se a primeira consulta falhar, o `except` segue e o
    # `return` lá embaixo referenciava nome inexistente — NameError virando 500 no
    # lugar da planilha vazia que o front sabe tratar.
    rateios, colunas = [], ["Condomínio", "Fundo Reserva"]

    try:
        # Os campos de parcelamento vem junto (0012/0013).
        #
        # A planilha da arrecadacao ja mostra "16/18" ao lado do valor de cada
        # mes, mas a conferencia selecionava so id/nome/ordem/grupo: quem emite
        # e quem aprova nunca viam que aquela verba e a 16a de 18 parcelas. A
        # informacao existia e parava no meio do caminho.
        rateios = db.table("rateios_config") \
            .select("id,nome,ordem,grupo_id,is_parcelado,parcela_total,parcela_inicio,mes_inicio") \
            .eq("condominio_id", condo_id).order("ordem").execute().data or []
        if rateios:
            r_ids = [r["id"] for r in rateios]
            colunas = [r["nome"] for r in rateios]
            vals = db.table("rateios_valores").select("rateio_id,month,valor,atualizado_em").in_("rateio_id", r_ids).eq("ano", year).execute().data or []
            
            if not vals:
                last = db.table("rateios_valores").select("ano").in_("rateio_id", r_ids).order("ano", desc=True).limit(1).execute().data
                if last:
                    year = last[0]["ano"]
                    vals = db.table("rateios_valores").select("rateio_id,month,valor,atualizado_em").in_("rateio_id", r_ids).eq("ano", year).execute().data or []
            
            # Quando o quadro de cada mes abriu, para este condominio. E a
            # referencia que separa previsao de valor revisado — e vem DEPOIS do
            # ajuste de `year` acima, senao consultaria o ano errado quando a
            # planilha do ano corrente esta vazia.
            aberturas = {}
            try:
                for e in (db.table("edicoes_mensais")
                            .select("mes_referencia,aberto_em,status")
                            .eq("condominio_id", condo_id).eq("ano_referencia", year)
                            .execute().data or []):
                    aberturas[e["mes_referencia"]] = e
            except Exception as e:
                print(f"[CONFERENCIA] aberturas falharam (segue sem): {e}")

            for i, m_item in enumerate(meses):
                m = m_item['mes']
                mv = [v for v in vals if int(v["month"]) == m]
                
                # Valores por coluna
                vals_col = {}
                total_mes = 0.0
                for r in rateios:
                    v_str = next((v["valor"] for v in mv if v["rateio_id"] == r["id"]), "0.00")
                    v_float = parse_valor(v_str)
                    vals_col[r["nome"]] = v_float
                    total_mes += v_float
                
                # Em que parcela cada verba esta NESTE mes.
                #
                # Mesma conta da tela de arrecadacao: a parcela do mes de
                # inicio e `parcela_inicio`, e anda de um em um. Fora da faixa
                # (antes de comecar ou depois de acabar) fica sem parcela — e
                # e assim que se sabe que ela ja terminou.
                parcelas_col = {}
                for r in rateios:
                    if not r.get("is_parcelado"):
                        continue
                    mes_ini = int(r.get("mes_inicio") or 1)
                    total_p = int(r.get("parcela_total") or 1)
                    ini_p = int(r.get("parcela_inicio") or 1)
                    if m < mes_ini:
                        continue
                    atual = ini_p + (m - mes_ini)
                    parcelas_col[r["nome"]] = {
                        "atual": atual if 1 <= atual <= total_p else None,
                        "total": total_p,
                        # Passou da ultima: a verba nao entra mais na emissao,
                        # mas continua no registro com a parcela em que parou.
                        "encerrada": atual > total_p,
                        "ultima_parcela": total_p,
                        "mes_da_ultima": mes_ini + (total_p - ini_p),
                    }

                # Verba cujo valor foi digitado ANTES de o quadro do mes abrir —
                # ou cujo quadro nunca abriu — e previsao que ninguem revisou
                # depois. Novembro e dezembro estao assim agora: numeros prontos
                # para um mes que ninguem comecou a trabalhar.
                abertura = (aberturas.get(m) or {}).get("aberto_em")
                revisao_col = {}
                for r in rateios:
                    v = next((x for x in mv if x["rateio_id"] == r["id"]), None)
                    if not v:
                        continue
                    carimbo = v.get("atualizado_em")
                    if not carimbo:
                        estado = None              # nao se sabe (anterior a 0107)
                    elif not abertura:
                        estado = True              # o mes nunca abriu
                    else:
                        estado = str(carimbo) < str(abertura)
                    revisao_col[r["nome"]] = {"em": carimbo, "previsao": estado}

                meses[i].update({'valores': vals_col, 'total': total_mes,
                                 'parcelas': parcelas_col, 'revisao': revisao_col,
                                 'mes_aberto_em': abertura})
                total_geral += total_mes
        else:
            colunas = ["Condomínio", "Fundo Reserva"]
    except Exception as e:
        print(f"[CONFERENCIA] Erro rateios: {e}"); traceback.print_exc()

    cobrancas = []
    try:
        # Filtra por mes/ano do pacote sendo conferido (frontend envia via query string)
        req_mes  = request.query_params.get("mes")
        req_ano  = request.query_params.get("ano")
        is_retif = request.query_params.get("retificacao") == "true"

        # `alteracao_*` vem junto (0105): a cobranca com mudanca pendente NAO
        # entra na emissao, e a tela precisa dizer por que ela esta travada —
        # do mesmo jeito que diz quando falta o documento.
        query = db.table("cobrancas_extras") \
            .select("id,description,amount,created_at,attachments,status,mes,ano,unidades,parcela_atual,parcela_total,grupo_id,"
                    "alteracao_proposta,alteracao_motivo,alteracao_pedida_por") \
            .eq("condominio_id", condo_id) \
            .neq("status", "cancelada")

        if req_mes and req_ano:
            query = query.eq("mes", int(req_mes)).eq("ano", int(req_ano))

        extras = query.order("created_at", desc=True).execute().data or []

        for c in extras:
            # Conferência normal: só 'ativa'. Retificação: inclui 'processada' também.
            if not is_retif and c.get("status") == "processada":
                continue

            atts = c.get('attachments') or []
            signed_atts = []
            for a in atts:
                try:
                    res = db.storage.from_("emissoes").create_signed_url(a, 3600)
                    signed_atts.append(res.get('signedURL', a) if isinstance(res, dict) else a)
                except Exception:
                    signed_atts.append(a)

            mes_int = c.get('mes')
            cobrancas.append({
                'id':          c.get('id'),
                'descricao':   c.get('description') or 'Cobrança Extra',
                'mes':         mes_int,
                'mes_nome':    MESES_PT.get(mes_int, '—'),
                'ano':         c.get('ano'),
                'valor':       parse_valor(c.get('amount')),
                'unidades':    c.get('unidades'),
                'attachments': signed_atts,
                # Parcelamento: quem emite precisa ver que aquilo é a 3ª de 6, e
                # não uma cobrança avulsa. Vinha só embutido no texto da
                # descrição — e só quando a cobrança nasceu pelo endpoint de
                # parcelamento. Agora vem como dado.
                'parcela_atual': c.get('parcela_atual'),
                'parcela_total': c.get('parcela_total'),
                'grupo_id':      c.get('grupo_id'),
            })
    except Exception as e:
        # Loga o erro real em vez de engolir silenciosamente
        print(f"[CONFERENCIA] Erro cobrancas_extras: {e}"); traceback.print_exc()

    # Grupos de emissão (0086). Um condomínio de dois vencimentos separa as verbas
    # em grupos, e tanto a conferência quanto o painel da emissão precisam mostrar
    # isso — senão "CASA ZELADOR VENC 10" fica solta no meio das outras, que é
    # exatamente o problema que os grupos vieram resolver.
    grupos, colunas_grupo = [], {}
    try:
        grupos = db.table("condominio_grupos").select("id, nome, due_day, ordem") \
            .eq("condominio_id", condo_id).eq("ativo", True).order("ordem").execute().data or []
        if grupos:
            # Verba sem grupo pertence ao primeiro (o "Geral" do backfill da 0086).
            padrao = grupos[0]["id"]
            for r in (rateios or []):
                colunas_grupo[r["nome"]] = r.get("grupo_id") or padrao
    except Exception as e:
        # 0086 não aplicada: a tela cai no modo antigo, sem faixas.
        print(f"[CONFERENCIA] grupos indisponíveis: {type(e).__name__}: {e}")
        grupos, colunas_grupo = [], {}

    return {
        'planilha': {
            'ano': year,
            'colunas': colunas,
            'meses': meses,
            'grupos': grupos,
            'colunas_grupo': colunas_grupo,
            'totais': {'total': round(total_geral, 2)}
        },
        'cobrancas_extras': cobrancas,
    }
class ApprovalActionV2(BaseModel):
    action: str              # 'approve' | 'reject'
    comment: Optional[str] = ""
    sign: Optional[bool] = False  # se True, registra assinatura digital

@router.post("/processo/{processo_id}/acao")
def api_processo_acao_v2(
    processo_id: str,
    data: ApprovalActionV2,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    """
    Aprova ou solicita correção de um processo.

    - Solicitar correção: volta o processo para o EMISSOR original (emitido_por)
      com status 'Solicitar alteração' e registra o comentário.
    - Aprovar + sign=True: registra assinatura digital (nome, role, timestamp, hash).
    """
    require_role(user, ROLES_APROVADORES)

    try:
        proc_res = db.table("processos").select("*").eq("id", processo_id).single().execute()
        if not proc_res.data:
            raise HTTPException(404, "Processo não encontrado")

        proc = proc_res.data
        current_status = proc.get("status")
        emitido_por = proc.get("emitido_por")

        update_payload = {}
        historico_action = ""

        if data.action == 'approve':
            # Busca o fluxo diretamente no processo
            fluxo = int(proc.get("fluxo", 1))

            # Lógica de Próximo Status baseada no Fluxo
            if fluxo == 1:
                # Nível 1: Direto para Supervisora Contabilidade -> Aprovado
                update_payload['status'] = 'aprovado'

            elif fluxo == 2 or fluxo == 3:
                # Nível 2 e 3: Gerente -> Supervisora Contabilidade -> Aprovado
                if current_status == 'Aguardando Gerente' or current_status == 'pendente':
                    update_payload['status'] = 'Aguardando Supervisor'
                else:
                    update_payload['status'] = 'aprovado'

            elif fluxo == 4:
                # Nível 4: Gerente -> Sup. Gerentes -> Sp. Contabilidade -> Aprovado
                if current_status == 'Aguardando Gerente' or current_status == 'pendente':
                    update_payload['status'] = 'Aguardando Chefe'
                elif current_status == 'Aguardando Chefe':
                    update_payload['status'] = 'Aguardando Supervisor'
                else:
                    update_payload['status'] = 'aprovado'
            else:
                update_payload['status'] = 'aprovado'

            historico_action = 'Aprovado'

            # Assinatura digital
            if data.sign:
                try:
                    import hashlib
                    content_hash = hashlib.sha256(
                        f"{processo_id}:{user['id']}:{datetime.utcnow().isoformat()}".encode()
                    ).hexdigest()
                    db.table("assinaturas").insert({
                        "processo_id": processo_id,
                        "signer_id": user['id'],
                        "signer_name": user.get('full_name') or user.get('email', 'Usuário'),
                        "signer_role": user.get('role'),
                        "signature_hash": content_hash,
                        "metadata": {"action": "approve", "step": current_status}
                    }).execute()
                except Exception as sign_err:
                    print(f"Erro ao assinar: {sign_err}")

        elif data.action == 'reject':
            if not data.comment or not data.comment.strip():
                raise HTTPException(400, "Motivo da correção é obrigatório")
            update_payload['status'] = 'Solicitar alteração'
            update_payload['issue_notes'] = data.comment.strip()
            historico_action = 'Solicitado alteração'
        else:
            raise HTTPException(400, f"Ação desconhecida: {data.action}")

        # Atualiza processo
        db.table("processos").update(update_payload).eq("id", processo_id).execute()

        # Registra no histórico
        db.table("aprovacoes").insert({
            "processo_id": processo_id,
            "approver_id": user['id'],
            "action": historico_action,
            "comment": data.comment or ""
        }).execute()

        return {
            "success": True,
            "next_status": update_payload.get('status'),
            "returned_to": emitido_por if data.action == 'reject' else None
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


# ═══ Endpoint: Documentos pendentes do usuário (para dashboard) ═══════

@router.get("/pendentes")
def api_pendentes(user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """
    Retorna documentos pendentes de ação do usuário atual.

    - Aprovadores: veem processos aguardando sua fila (Enviado, Em aprovação)
    - Emissores/Gerentes/Assistentes: veem os que voltaram para correção deles
    """
    role = user.get('role')
    try:
        query = db.table("processos").select(
            "id, status, issue_notes, condominio_id, emitido_por, condominios(name)"
        )

        if role in ROLES_APROVADORES or role == 'supervisor_gerentes':
            # Determinar qual status este usuário aprova
            status_target = []
            if role == 'master':
                # Master vê tudo que está aguardando
                pass
            elif role == 'gerente':
                status_target = ['Aguardando Gerente']
            elif role == 'supervisora':
                status_target = ['Aguardando Supervisora']
            elif role == 'supervisora_contabilidade':
                status_target = ['Aguardando Sp. Contabilidade']
            elif role == 'supervisor_gerentes':
                status_target = ['Aguardando Sup. Gerentes']
                
            if status_target:
                query = query.in_("status", status_target)
            else:
                query = query.like("status", "Aguardando%")

            # Gerente vê só dos condomínios dele
            if role == 'gerente':
                g_id = get_gerente_id(db, user['id'])
                if g_id:
                    condos_res = db.table("condominios").select("id").eq("gerente_id", g_id).execute()
                    condo_ids = [c['id'] for c in (condos_res.data or [])]
                    if condo_ids:
                        query = query.in_("condominio_id", condo_ids)
                    else:
                        return {"pendentes": []}
        elif role in ['emissor', 'assistente', 'departamento']:
            # Emissor/assistente vê os que voltaram pra correção (emitidos por ele ou com status Solicitar alteração)
            query = query.eq("status", "Solicitar alteração")
        else:
            return {"pendentes": []}

        res = query.execute()
        items = []
        for p in (res.data or []):
            items.append({
                'id': p['id'],
                'status': p.get('status'),
                'issue_notes': p.get('issue_notes'),
                'condominio_id': p.get('condominio_id'),
                'condominio_nome': (p.get('condominios') or {}).get('name', 'Condomínio'),
                'emitido_por': p.get('emitido_por'),
            })

        return {"pendentes": items}
    except Exception as e:
        raise HTTPException(400, str(e))


# ═══ Endpoint: Assinaturas de um processo ═════════════════════════════

@router.get("/processo/{processo_id}/assinaturas")
def api_assinaturas(processo_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Lista assinaturas digitais de um processo."""
    try:
        res = db.table("assinaturas") \
            .select("id, signer_name, signer_role, signed_at, signature_hash") \
            .eq("processo_id", processo_id) \
            .order("signed_at") \
            .execute()
        return {"assinaturas": res.data or []}
    except Exception as e:
        raise HTTPException(400, str(e))


# ═══ Vínculo gerente -> assistente ════════════════════════════════════

class VincularAssistenteSchema(BaseModel):
    gerente_id: str
    assistente_profile_id: Optional[str] = None  # None = remove vínculo


@router.post("/gerentes/vincular-assistente")
def api_vincular_assistente(
    data: VincularAssistenteSchema,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    """Vincula um assistente a um gerente (apenas master)."""
    require_role(user, ['master'])
    try:
        db.table("gerentes").update({
            "assistente_id": data.assistente_profile_id
        }).eq("id", data.gerente_id).execute()
        return {"success": True}
    except Exception as e:
        raise HTTPException(400, str(e))# ═══════════════════════════════════════════════════════════════
# Cole no FINAL do arquivo api/api_routes.py
# ═══════════════════════════════════════════════════════════════

from datetime import datetime as _dt

ROLES_LANCA_COBRANCA  = ['master', 'gerente', 'assistente']
ROLES_SOLICITA_CANCEL = ['master', 'gerente', 'assistente']
ROLES_EXECUTA_CANCEL  = ['master', 'departamento']

def _mes_atual():
    n = _dt.now()
    return n.month, n.year

class CobrancaExtraSchema(BaseModel):
    condominio_id: str
    descricao: str
    valor_total: float
    mes_inicio: int
    ano_inicio: int
    parcelas: int = 1   # 1 = sem parcelamento
    attachments: Optional[list] = []
    unidades: Optional[str] = None   # unidade(s) do condomínio (obrigatório)

@router.post("/cobrancas-extras/lancar")
def api_lancar_cobranca_extra(
    data: CobrancaExtraSchema,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    """Lança cobrança extra (simples ou parcelada). Não permite retroativo."""
    require_role(user, ROLES_LANCA_COBRANCA)

    # Gerente/assistente só lançam para condomínios da própria carteira
    if user["role"] in ("gerente", "assistente"):
        if data.condominio_id not in carteira_condo_ids(db, user):
            raise HTTPException(403, "Este condomínio não está na sua carteira.")

    mes_atual, ano_atual = _mes_atual()

    # Valida que não é retroativo
    if (data.ano_inicio < ano_atual) or \
       (data.ano_inicio == ano_atual and data.mes_inicio < mes_atual):
        raise HTTPException(400, "Não é permitido lançar cobranças retroativas.")

    if data.parcelas < 1 or data.parcelas > 600:
        raise HTTPException(400, "Número de parcelas deve ser entre 1 e 600.")

    if data.valor_total == 0:
        raise HTTPException(400, "Valor não pode ser zero (use negativo para crédito/abatimento).")

    if not (data.unidades and data.unidades.strip()):
        raise HTTPException(400, "Informe a(s) unidade(s) do condomínio.")

    # Documento obrigatório.
    #
    # Cobrança extra é dinheiro cobrado do condômino: sem o documento que a
    # justifica, ninguém consegue responder "por que estou pagando isso?" — nem
    # o gerente, nem a emissão, nem o síndico seis meses depois.
    #
    # Foi assim que a mesma cobrança entrou duas vezes num condomínio: uma com
    # anexo e outra sem, e não havia como saber qual era a boa.
    if not (data.attachments and any(str(a_).strip() for a_ in data.attachments)):
        raise HTTPException(400, "Anexe o documento que comprova a cobrança. "
                                 "Cobrança extra sem documento não pode ser lançada.")

    import uuid
    grupo_id = str(uuid.uuid4())
    valor_parcela = round(data.valor_total / data.parcelas, 2)

    try:
        registros = []
        for i in range(data.parcelas):
            # Calcula mês/ano de cada parcela
            mes = data.mes_inicio + i
            ano = data.ano_inicio
            while mes > 12:
                mes -= 12
                ano += 1

            desc = data.descricao
            if data.parcelas > 1:
                desc = f"{data.descricao} ({i+1}/{data.parcelas})"

            # Última parcela absorve o arredondamento -> a soma das parcelas fecha o total exato
            amount = round(data.valor_total - valor_parcela * (data.parcelas - 1), 2) if i == data.parcelas - 1 else valor_parcela

            registros.append({
                "condominio_id": data.condominio_id,
                "description": desc,
                "amount": amount,
                "mes": mes,
                "ano": ano,
                "parcela_atual": i + 1,
                "parcela_total": data.parcelas,
                "grupo_id": grupo_id,
                "status": "ativa",
                "attachments": data.attachments,
                "unidades": data.unidades.strip(),
            })

        db.table("cobrancas_extras").insert(registros).execute()
        return {"success": True, "grupo_id": grupo_id, "parcelas_criadas": len(registros)}
    except Exception as e:
        raise HTTPException(400, str(e))



class SolicitarCancelamentoSchema(BaseModel):
    grupo_id: str
    motivo: str

@router.post("/cobrancas-extras/solicitar-cancelamento")
def api_solicitar_cancelamento(
    data: SolicitarCancelamentoSchema,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    """Gerente solicita cancelamento das parcelas futuras de uma cobrança."""
    require_role(user, ROLES_SOLICITA_CANCEL)

    mes_atual, ano_atual = _mes_atual()

    try:
        # Marca parcelas futuras como 'solicitado_cancelamento'
        parcelas = db.table("cobrancas_extras").select("id, mes, ano") \
            .eq("grupo_id", data.grupo_id).eq("status", "ativa").execute().data or []

        ids_futuros = []
        for p in parcelas:
            p_mes, p_ano = p["mes"], p["ano"]
            if (p_ano > ano_atual) or (p_ano == ano_atual and p_mes >= mes_atual):
                ids_futuros.append(p["id"])

        if not ids_futuros:
            raise HTTPException(400, "Não há parcelas futuras para cancelar.")

        db.table("cobrancas_extras").update({
            "status": "solicitado_cancelamento",
            "motivo_cancelamento": data.motivo,
            "solicitado_por": user["id"]
        }).in_("id", ids_futuros).execute()

        return {"success": True, "parcelas_solicitadas": len(ids_futuros)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


class ExecutarCancelamentoSchema(BaseModel):
    grupo_id: str

@router.post("/cobrancas-extras/executar-cancelamento")
def api_executar_cancelamento(
    data: ExecutarCancelamentoSchema,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    """Emissor ou Master executa o cancelamento das parcelas solicitadas."""
    require_role(user, ROLES_EXECUTA_CANCEL)

    try:
        db.table("cobrancas_extras").update({
            "status": "cancelada",
            "cancelado_por": user["id"]
        }).eq("grupo_id", data.grupo_id).eq("status", "solicitado_cancelamento").execute()

        return {"success": True}
    except Exception as e:
        raise HTTPException(400, str(e))


# =============================================================================
# Gerente na operacao, e a carteira que ele deixa para tras
# =============================================================================

# A situacao do condominio nao se define a mao.
#
# Existia aqui um POST /condominios/{id}/situacao para colocar um condominio em
# operacao. Saiu com a 0106: a situacao passou a ser consequencia do gerente, e
# uma rota que a define direto seria uma segunda fonte da verdade — a que
# diverge primeiro. Quem muda a situacao de um condominio agora e quem muda o
# gerente dele, ou a situacao do gerente.


class SituacaoGerenteSchema(BaseModel):
    ativo: bool
    ativo_desde: Optional[str] = None     # "2026-09-01" — para quem comeca depois
    motivo: Optional[str] = None


@router.post("/gerentes/{gerente_id}/situacao")
def api_situacao_gerente(
    gerente_id: str,
    data: SituacaoGerenteSchema,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db),
):
    """Marca o gerente como dentro ou fora da operacao (0104).

    Sao 15 cadastrados e 3 trabalhando. Sem esta marca o sistema abria o quadro
    do mes para os 15 e cobrava planilha de quem nao esta mais aqui.

    Inativar com carteira cheia NAO e bloqueado, mas a resposta diz quantos
    condominios ficaram sem gerente ativo. Bloquear obrigaria a transferir
    primeiro, e quem sai da empresa costuma sair antes de alguem decidir quem
    assume — o aviso e mais honesto do que a porta fechada.
    """
    require_role(user, ["master"])

    payload = {"ativo": bool(data.ativo), "ativo_desde": data.ativo_desde or None}
    if not data.ativo:
        payload["inativado_em"] = _dt.now().isoformat()
        payload["inativado_motivo"] = (data.motivo or "").strip() or None
    else:
        payload["inativado_em"] = None
        payload["inativado_motivo"] = None

    res = db.table("gerentes").update(payload).eq("id", gerente_id).execute()
    if not res.data:
        raise HTTPException(404, "Gerente nao encontrado.")

    orfaos = (db.table("condominios").select("id", count="exact")
                .eq("gerente_id", gerente_id).limit(1).execute().count or 0)

    # A carteira acompanha sozinha.
    #
    # Isto era um bloco que percorria os condominios do gerente e os ligava um a
    # um. Virou trigger no banco (0106): a situacao do condominio e consequencia
    # do gerente, entao mudar o gerente ja arrasta a carteira. Duas mecanicas
    # para a mesma regra e uma delas ficando para tras com o tempo.
    # Quantos a carteira tem agora em operacao — depois do trigger.
    em_operacao = (db.table("condominios").select("id", count="exact")
                     .eq("gerente_id", gerente_id).eq("situacao", "ativo")
                     .limit(1).execute().count or 0)

    return {
        "success": True,
        "ativo": bool(data.ativo),
        "condominios_na_carteira": orfaos,
        "condominios_que_entraram": em_operacao if data.ativo else 0,
    }


class TransferirCarteiraSchema(BaseModel):
    de_gerente_id: str
    para_gerente_id: str
    condominio_ids: Optional[list] = None   # None = a carteira inteira


@router.post("/gerentes/transferir-carteira")
def api_transferir_carteira(
    data: TransferirCarteiraSchema,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db),
):
    """Passa condominios de um gerente para outro de uma vez.

    Antes so existia o vinculo um a um, na tela de carteira. Um gerente que sai
    com 40 condominios eram 40 operacoes manuais — e o custo disso e alguem
    desistir no meio e deixar metade da carteira orfa.

    `condominio_ids` nulo transfere a carteira inteira. O destino precisa estar
    ATIVO: mandar condominio para quem ja saiu e o mesmo problema com outro
    nome.
    """
    require_role(user, ["master"])

    if data.de_gerente_id == data.para_gerente_id:
        raise HTTPException(400, "Origem e destino sao o mesmo gerente.")

    destino = (db.table("gerentes").select("id, nome, ativo")
                 .eq("id", data.para_gerente_id).maybe_single().execute().data)
    if not destino:
        raise HTTPException(404, "Gerente de destino nao encontrado.")
    if destino.get("ativo") is False:
        raise HTTPException(400, "O gerente de destino esta inativo. Ative-o antes de passar a carteira.")

    q = db.table("condominios").select("id").eq("gerente_id", data.de_gerente_id)
    if data.condominio_ids:
        q = q.in_("id", data.condominio_ids)
    alvos = [c["id"] for c in (q.execute().data or [])]

    if not alvos:
        return {"success": True, "transferidos": 0}

    # Em blocos: um `in_` com centenas de ids estoura o tamanho da URL do
    # PostgREST, e o erro que volta nao diz isso.
    movidos = 0
    for i in range(0, len(alvos), 100):
        bloco = alvos[i:i + 100]
        r = db.table("condominios").update({"gerente_id": data.para_gerente_id}) \
              .in_("id", bloco).execute()
        movidos += len(r.data or [])

    print(f"[carteira] {movidos} condominios de {data.de_gerente_id} para {data.para_gerente_id} por {user.get('email')}")
    return {"success": True, "transferidos": movidos, "destino": destino.get("nome")}


# =============================================================================
# Alterar uma cobranca ja lancada — com aprovacao
# =============================================================================

CAMPOS_ALTERAVEIS = {"amount", "mes", "ano", "description", "unidades"}


class PedirAlteracaoSchema(BaseModel):
    proposta: dict            # so os campos que mudam
    motivo: str
    grupo_todo: bool = False  # aplica a todas as parcelas do mesmo lancamento


@router.post("/cobrancas-extras/{cobranca_id}/alterar")
def api_pedir_alteracao_cobranca(
    cobranca_id: str,
    data: PedirAlteracaoSchema,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db),
):
    """Pede para mudar valor, mes, descricao ou unidade de uma cobranca (0105).

    Mesmo desenho do cancelamento: gerente e assistente pedem, master e
    departamento decidem. A mudanca nao vale enquanto ninguem decidir, e a
    cobranca fica FORA da emissao nesse meio tempo — cobrar um valor sob revisao
    e o erro que esta aprovacao existe para evitar.
    """
    require_role(user, ROLES_SOLICITA_CANCEL)

    motivo = (data.motivo or "").strip()
    if not motivo:
        raise HTTPException(400, "Diga por que a alteracao e necessaria. Quem aprova decide com isto.")

    proposta = {k: v for k, v in (data.proposta or {}).items() if k in CAMPOS_ALTERAVEIS}
    if not proposta:
        raise HTTPException(400, "Nenhum campo alteravel foi enviado.")

    if "mes" in proposta and not (1 <= int(proposta["mes"]) <= 12):
        raise HTTPException(400, "Mes fora do intervalo.")

    atual = (db.table("cobrancas_extras")
               .select("id, condominio_id, grupo_id, description, amount, mes, ano, unidades, status, alteracao_proposta")
               .eq("id", cobranca_id).maybe_single().execute().data)
    if not atual:
        raise HTTPException(404, "Cobranca nao encontrada.")
    if atual.get("status") == "cancelada":
        raise HTTPException(400, "Esta cobranca esta cancelada.")
    if atual.get("alteracao_proposta"):
        raise HTTPException(400, "Ja existe uma alteracao esperando decisao nesta cobranca.")

    # Gerente e assistente so mexem na propria carteira — a mesma regra do lancar.
    if user["role"] in ("gerente", "assistente"):
        if atual.get("condominio_id") not in carteira_condo_ids(db, user):
            raise HTTPException(403, "Este condominio nao esta na sua carteira.")

    alvos = [cobranca_id]
    if data.grupo_todo and atual.get("grupo_id"):
        # Parcelamento: mudar o valor de uma parcela e quase sempre querer mudar
        # o das que ainda nao sairam.
        irmas = (db.table("cobrancas_extras").select("id")
                   .eq("grupo_id", atual["grupo_id"]).eq("status", "ativa")
                   .is_("alteracao_proposta", "null").execute().data or [])
        alvos = list({c["id"] for c in irmas} | {cobranca_id})

    payload = {
        "alteracao_proposta": proposta,
        "alteracao_motivo": motivo,
        "alteracao_pedida_por": user.get("email") or user.get("id"),
        "alteracao_pedida_em": _dt.now().isoformat(),
        "alteracao_decidida_por": None,
        "alteracao_decidida_em": None,
        "alteracao_recusa_motivo": None,
    }
    db.table("cobrancas_extras").update(payload).in_("id", alvos).execute()
    return {"success": True, "cobrancas_afetadas": len(alvos)}


class DecidirAlteracaoSchema(BaseModel):
    aprovar: bool
    motivo: Optional[str] = None


@router.post("/cobrancas-extras/{cobranca_id}/alteracao/decidir")
def api_decidir_alteracao_cobranca(
    cobranca_id: str,
    data: DecidirAlteracaoSchema,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db),
):
    """Master ou emissao aprova ou recusa a alteracao pedida."""
    require_role(user, ROLES_EXECUTA_CANCEL)

    atual = (db.table("cobrancas_extras")
               .select("id, description, amount, mes, ano, unidades, alteracao_proposta, alteracao_motivo, alteracao_pedida_por, alteracao_pedida_em")
               .eq("id", cobranca_id).maybe_single().execute().data)
    if not atual:
        raise HTTPException(404, "Cobranca nao encontrada.")
    proposta = atual.get("alteracao_proposta")
    if not proposta:
        raise HTTPException(400, "Esta cobranca nao tem alteracao pendente.")

    antes = {k: atual.get(k) for k in CAMPOS_ALTERAVEIS}

    limpar = {
        "alteracao_proposta": None,
        "alteracao_motivo": None,
        "alteracao_pedida_por": None,
        "alteracao_pedida_em": None,
        "alteracao_decidida_por": user.get("email") or user.get("id"),
        "alteracao_decidida_em": _dt.now().isoformat(),
        "alteracao_recusa_motivo": None if data.aprovar else ((data.motivo or "").strip() or None),
    }

    if data.aprovar:
        aplicar = {k: v for k, v in proposta.items() if k in CAMPOS_ALTERAVEIS}
        db.table("cobrancas_extras").update({**aplicar, **limpar}).eq("id", cobranca_id).execute()
    else:
        db.table("cobrancas_extras").update(limpar).eq("id", cobranca_id).execute()

    # O historico sobrevive ao proximo pedido: a linha da cobranca so guarda o
    # que esta em aberto, e a segunda alteracao apagaria o rastro da primeira.
    try:
        db.table("cobrancas_alteracoes").insert({
            "cobranca_id": cobranca_id,
            "antes": antes,
            "proposta": proposta,
            "motivo": atual.get("alteracao_motivo"),
            "decisao": "aprovada" if data.aprovar else "recusada",
            "decisao_motivo": (data.motivo or "").strip() or None,
            "pedida_por": atual.get("alteracao_pedida_por"),
            "pedida_em": atual.get("alteracao_pedida_em"),
            "decidida_por": user.get("email") or user.get("id"),
        }).execute()
    except Exception as e:
        print(f"[cobrancas/alteracao] historico falhou (decisao ja aplicada): {e}")

    return {"success": True, "aprovada": bool(data.aprovar)}


@router.get("/cobrancas-extras/alteracoes-pendentes")
def api_alteracoes_pendentes(
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db),
):
    """As alteracoes esperando decisao — para o painel de quem decide."""
    require_role(user, ROLES_EXECUTA_CANCEL)
    rows = (db.table("cobrancas_extras")
              .select("id, description, amount, mes, ano, unidades, condominio_id, "
                      "alteracao_proposta, alteracao_motivo, alteracao_pedida_por, alteracao_pedida_em, "
                      "condominios(name)")
              .not_.is_("alteracao_proposta", "null")
              .order("alteracao_pedida_em", desc=False).execute().data or [])
    return {"pendentes": rows, "total": len(rows)}


class DocumentoCobrancaSchema(BaseModel):
    attachments: list


@router.post("/cobrancas-extras/{cobranca_id}/documento")
def api_anexar_documento_cobranca(
    cobranca_id: str,
    data: DocumentoCobrancaSchema,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    """Anexa o documento que faltou numa cobranca extra ja lancada.

    A trava de documento obrigatorio so vale para o que nasce depois dela — e
    35 cobrancas foram lancadas antes, 31 delas no mes que esta sendo emitido
    agora. Sem esta rota, cada uma delas fica travada para sempre: nao entra na
    emissao por falta de documento e nao ha onde anexar o documento.

    Nao substitui o que ja existe: acrescenta. Trocar um comprovante por outro
    e outra operacao, e apagar o anterior calado seria pior do que nao ter.
    """
    require_role(user, ROLES_LANCA_COBRANCA + ["departamento"])

    novos = [str(a).strip() for a in (data.attachments or []) if str(a).strip()]
    if not novos:
        raise HTTPException(400, "Nenhum documento recebido.")

    row = db.table("cobrancas_extras")         .select("id, condominio_id, attachments, status")         .eq("id", cobranca_id).maybe_single().execute().data
    if not row:
        raise HTTPException(404, "Cobranca nao encontrada.")

    # Gerente/assistente so mexem na propria carteira — a mesma regra do lancar.
    if user["role"] in ("gerente", "assistente"):
        if row.get("condominio_id") not in carteira_condo_ids(db, user):
            raise HTTPException(403, "Este condominio nao esta na sua carteira.")

    atuais = row.get("attachments") or []
    res = db.table("cobrancas_extras")         .update({"attachments": atuais + novos})         .eq("id", cobranca_id).execute()
    if not res.data:
        raise HTTPException(400, "O documento nao foi gravado.")

    return {"success": True, "attachments": atuais + novos}


@router.get("/cobrancas-extras/cancelamentos-pendentes")
def api_cancelamentos_pendentes(
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    """Lista cobranças com cancelamento solicitado — visível para Emissor e Master."""
    require_role(user, ROLES_EXECUTA_CANCEL)

    try:
        res = db.table("cobrancas_extras") \
            .select("grupo_id, description, mes, ano, amount, motivo_cancelamento, condominio_id, condominios(name)") \
            .eq("status", "solicitado_cancelamento") \
            .order("created_at") \
            .execute()

        # Agrupa por grupo_id para mostrar apenas um card por lançamento
        grupos = {}
        for r in (res.data or []):
            gid = r["grupo_id"]
            if gid not in grupos:
                grupos[gid] = {
                    "grupo_id": gid,
                    "descricao": r["description"].split(" (")[0],  # remove "(1/3)"
                    "condominio": (r.get("condominios") or {}).get("name", ""),
                    "condominio_id": r["condominio_id"],
                    "motivo": r["motivo_cancelamento"],
                    "parcelas_pendentes": 0,
                    "valor_parcela": r["amount"],
                    "mes_inicio": r["mes"],
                    "ano_inicio": r["ano"],
                }
            grupos[gid]["parcelas_pendentes"] += 1

        return {"pendentes": list(grupos.values())}
    except Exception as e:
        raise HTTPException(400, str(e))


@router.get("/cobrancas-extras/{condominio_id}")
def api_listar_cobrancas(
    condominio_id: str,
    mes: Optional[int] = None,
    ano: Optional[int] = None,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    """Lista cobranças extras de um condomínio, opcionalmente filtradas por mês/ano."""
    # Gerente/assistente só enxergam cobranças de condomínios da própria carteira
    if user["role"] in ("gerente", "assistente"):
        if condominio_id not in carteira_condo_ids(db, user):
            raise HTTPException(403, "Este condomínio não está na sua carteira.")
    try:
        query = db.table("cobrancas_extras").select("*") \
            .eq("condominio_id", condominio_id) \
            .neq("status", "cancelada")
            
        if mes and ano:
            query = query.eq("mes", mes).eq("ano", ano)
            # Ao filtrar por mês, mostramos ativas e processadas (para conferência/histórico)
        
        # Note: Não filtramos por status 'ativa' aqui por padrão para que o painel de 
        # gerenciamento continue mostrando o histórico (ex: parcelas já processadas).
        # A limpeza visual "para as próximas" acontece no endpoint api_dados_conferencia.
            
        query = query.order("ano").order("mes")

        res = query.execute()
        
        cobrancas = res.data or []
        for c in cobrancas:
            if c.get("attachments"):
                signed_atts = []
                for a in c["attachments"]:
                    try:
                        res_url = db.storage.from_("emissoes").create_signed_url(a, 3600)
                        signed_atts.append(res_url.get('signedURL', a) if isinstance(res_url, dict) else a)
                    except:
                        signed_atts.append(a)
                c["attachments"] = signed_atts

        return {"cobrancas": cobrancas}
    except Exception as e:
        raise HTTPException(400, str(e))


# ============================================================
# EXTRACAO DE DADOS DE FATURA (Concessionaria) via Claude Vision
# ============================================================

@router.post("/emissoes/arquivos/{arquivo_id}/extrair-fatura")
def api_extrair_fatura(arquivo_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """
    Le um PDF de concessionaria (SABESP/COMGAS/ENEL) com Claude Haiku Vision
    e extrai: nome_condominio, vencimento, valor.
    """
    import base64
    import json as _json
    import re as _re
    from datetime import datetime

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(503, "ANTHROPIC_API_KEY nao configurada no servidor.")

    # 1. Busca o registro do arquivo
    arq_res = db.table("emissoes_arquivos").select("*").eq("id", arquivo_id).limit(1).execute()
    if not arq_res.data:
        raise HTTPException(404, "Arquivo nao encontrado")
    arq = arq_res.data[0]

    if arq.get("categoria") != "concessionaria":
        raise HTTPException(400, "Extracao disponivel apenas para categoria 'concessionaria'")

    storage_path = arq.get("arquivo_url")
    if not storage_path:
        raise HTTPException(400, "Caminho do arquivo nao encontrado")

    # 2. Download do PDF do Supabase Storage
    try:
        pdf_bytes = db.storage.from_("emissoes").download(storage_path)
    except Exception as e:
        raise HTTPException(500, f"Erro ao baixar PDF: {e}")

    pdf_b64 = base64.standard_b64encode(pdf_bytes).decode("utf-8")
    subtipo = (arq.get("subtipo") or "concessionaria").upper()

    # 3. Chamada ao Claude com PDF anexado
    try:
        from anthropic import Anthropic
        client = Anthropic(api_key=api_key)

        prompt = f"""Voce esta lendo uma fatura de concessionaria brasileira ({subtipo}).

Extraia EXATAMENTE 3 informacoes e retorne SOMENTE um JSON valido neste formato (sem markdown, sem explicacoes):

{{
  "nome_condominio": "Nome do condominio/cliente conforme aparece na conta",
  "vencimento": "YYYY-MM-DD",
  "valor": 0.00
}}

Regras:
- nome_condominio: pegue o campo "Cliente", "Razao Social" ou o nome do edificio/condominio impresso no topo. NUNCA pegue o nome da concessionaria (SABESP/COMGAS/ENEL).
- vencimento: data de vencimento da fatura (NAO confunda com data de emissao ou proxima leitura). Formato ISO YYYY-MM-DD.
- valor: valor TOTAL a pagar em reais (decimal com ponto). Se houver "Total" e "Subtotal", use o TOTAL final.
- Se nao conseguir extrair algum campo com certeza, use null.

Retorne APENAS o JSON, nada mais."""

        message = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=512,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": pdf_b64,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }],
        )

        raw = message.content[0].text.strip()
        # Remove possivel cerca de markdown
        raw = _re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=_re.MULTILINE).strip()
        parsed = _json.loads(raw)

    except Exception as e:
        raise HTTPException(500, f"Falha na extracao por IA: {e}")

    # 4. Sanitiza valores
    nome = (parsed.get("nome_condominio") or "").strip() or None
    venc = parsed.get("vencimento")
    if venc:
        try:
            datetime.strptime(venc, "%Y-%m-%d")
        except Exception:
            venc = None
    valor = parsed.get("valor")
    try:
        valor = float(valor) if valor is not None else None
    except Exception:
        valor = None

    # 5. Persiste
    update_payload = {
        "nome_condominio_fatura": nome,
        "vencimento_fatura": venc,
        "valor_fatura": valor,
        "dados_extraidos_em": datetime.utcnow().isoformat(),
    }
    db.table("emissoes_arquivos").update(update_payload).eq("id", arquivo_id).execute()

    return {"ok": True, **update_payload}


class FaturaManualUpdate(BaseModel):
    nome_condominio_fatura: Optional[str] = None
    vencimento_fatura: Optional[str] = None  # YYYY-MM-DD
    valor_fatura: Optional[float] = None


@router.patch("/emissoes/arquivos/{arquivo_id}/fatura")
def api_atualizar_fatura(arquivo_id: str, data: FaturaManualUpdate, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Permite correcao manual dos campos extraidos pela IA."""
    from datetime import datetime
    payload = data.dict(exclude_unset=True)
    if "vencimento_fatura" in payload and payload["vencimento_fatura"]:
        try:
            datetime.strptime(payload["vencimento_fatura"], "%Y-%m-%d")
        except Exception:
            raise HTTPException(400, "vencimento_fatura deve estar em YYYY-MM-DD")
    payload["dados_extraidos_em"] = datetime.utcnow().isoformat()
    db.table("emissoes_arquivos").update(payload).eq("id", arquivo_id).execute()
    return {"ok": True}


# ============================================================
# EDICOES MENSAIS - ciclo de revisao e liberacao por gerente
# ============================================================

def _mes_alvo_padrao():
    """Mes/ano alvo padrao = M+1 (em junho abrimos julho)."""
    from datetime import datetime
    now = datetime.now()
    if now.month == 12:
        return 1, now.year + 1
    return now.month + 1, now.year


class AbrirEdicaoSchema(BaseModel):
    mes: Optional[int] = None
    ano: Optional[int] = None
    gerente_id: Optional[str] = None  # se nulo, abre pra todos
    condominio_id: Optional[str] = None  # 1-a-1: abre/reabre só este condomínio
    forcar_reabertura: Optional[bool] = False  # em massa: reabrir até o que o gerente já liberou


@router.get("/edicoes-mensais/previa-abertura")
def api_previa_abertura(
    mes: int, ano: int,
    gerente_id: Optional[str] = None,
    condominio_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db),
):
    """O que vai acontecer se abrir este mes — antes de clicar.

    O botao dizia "abrir outubro para 30 condominios" e a pergunta que vinha era
    "por que todos, se ela ja preencheu?". Duas coisas se confundiam ali:
    PREENCHIDO e LIBERADO. A gerente pode ter digitado a previsao de outubro em
    dois condominios e nao ter liberado nenhum — e ai abrir os trinta esta certo,
    mas o botao nao dizia nada sobre os dois que ja tem valor esperando.

    Aqui saem os tres numeros separados, para o botao poder falar a verdade.
    """
    require_role(user, ["master", "departamento"])

    q = db.table("condominios").select("id, gerente_id").eq("situacao", "ativo")
    if condominio_id:
        q = q.eq("id", condominio_id)
    elif gerente_id:
        g_real = get_gerente_id(db, gerente_id) or gerente_id
        q = q.eq("gerente_id", g_real)
    condos = q.execute().data or []
    ids = [c["id"] for c in condos]
    if not ids:
        return {"total": 0, "ja_liberados": 0, "ja_preenchidos": 0, "vao_abrir": 0}

    ed = (db.table("edicoes_mensais").select("condominio_id, status")
            .in_("condominio_id", ids)
            .eq("mes_referencia", mes).eq("ano_referencia", ano).execute().data or [])
    liberados = {e["condominio_id"] for e in ed if e["status"] == "edicao_finalizada"}

    # Quem ja tem valor digitado neste mes — liberado ou nao. E o que a gerente
    # adiantou, e o que ela vai precisar conferir quando o mes abrir.
    preenchidos = set()
    try:
        rc = (db.table("rateios_config").select("id, condominio_id")
                .in_("condominio_id", ids).execute().data or [])
        por_rateio = {r["id"]: r["condominio_id"] for r in rc}
        if por_rateio:
            chaves = list(por_rateio.keys())
            for i in range(0, len(chaves), 200):
                vs = (db.table("rateios_valores").select("rateio_id, valor")
                        .in_("rateio_id", chaves[i:i + 200])
                        .eq("month", mes).eq("ano", ano).execute().data or [])
                for v in vs:
                    # `parse_valor` e aninhada em outra funcao e nao existe aqui.
                    # A conversao e a mesma: o valor e TEXT e pode vir com
                    # virgula, ou com palavra ("PLANILHA") — o que nao converte
                    # nao conta como preenchido.
                    try:
                        n = float(str(v.get("valor") or "0").replace(",", "."))
                    except (TypeError, ValueError):
                        n = 0.0
                    if n > 0:
                        preenchidos.add(por_rateio[v["rateio_id"]])
    except Exception as e:
        print(f"[previa-abertura] preenchidos falhou (segue sem): {e}")

    return {
        "total": len(ids),
        "ja_liberados": len(liberados),
        "ja_preenchidos": len(preenchidos - liberados),
        "vao_abrir": len(ids) - len(liberados),
    }


@router.post("/edicoes-mensais/abrir")
def api_abrir_edicao(data: AbrirEdicaoSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    # Abrir/reabrir edição = emissor (departamento) ou master (antes: só master)
    if user.get("role") not in EMIT_DOCUMENT:
        raise HTTPException(403, "Apenas o emissor ou o master pode abrir/reabrir edição mensal")
    mes_padrao, ano_padrao = _mes_alvo_padrao()
    mes = data.mes or mes_padrao
    ano = data.ano or ano_padrao
    if mes < 1 or mes > 12:
        raise HTTPException(400, "mes invalido")

    # So os gerentes que estao na operacao (0104).
    #
    # Sao 15 cadastrados e 3 trabalhando: sem este recorte o quadro do mes abria
    # para os 15, e o painel passava a cobrar planilha de quem ja saiu. Quem
    # comeca depois (`ativo_desde` no futuro) tambem fica de fora ate a data.
    hoje_iso = _dt.now().date().isoformat()
    ativos = db.table("gerentes").select("id, ativo, ativo_desde").execute().data or []
    ids_ativos = [g["id"] for g in ativos
                  if g.get("ativo") is not False
                  and (not g.get("ativo_desde") or str(g["ativo_desde"]) <= hoje_iso)]

    # Quem ainda vai entrar nao recebe quadro de mes: abrir a planilha de um
    # condominio que ainda nao e cliente e criar trabalho que ninguem pediu.
    cond_q = db.table("condominios").select("id, gerente_id").eq("situacao", "ativo")
    if data.condominio_id:
        cond_q = cond_q.eq("id", data.condominio_id)
    elif data.gerente_id:
        # O front manda o id do PROFILE; condominios.gerente_id é gerentes.id -> resolve
        g_real = get_gerente_id(db, data.gerente_id) or data.gerente_id
        cond_q = cond_q.eq("gerente_id", g_real)
    cond_res = cond_q.execute()
    condos = cond_res.data or []

    # O recorte por gerente ativo vale para a abertura EM MASSA. Quando o master
    # escolhe um condominio especifico, ele sabe o que esta fazendo — abrir para
    # um condominio de carteira inativa e um ato deliberado, e travar aqui seria
    # tirar dele a unica saida quando alguem sai no meio do mes.
    if not data.condominio_id:
        antes = len(condos)
        condos = [c for c in condos if c.get("gerente_id") in ids_ativos]
        ignorados = antes - len(condos)
        if ignorados:
            print(f"[edicoes/abrir] {ignorados} condominios fora: gerente inativo")

    # Só REABRE o que o gerente já liberou quando o master escolheu o condomínio (1-a-1)
    # ou pediu explicitamente pra forçar. Em massa, a previsão que ele já liberou fica de pé.
    pode_reabrir = bool(data.condominio_id) or bool(data.forcar_reabertura)

    criados = 0
    reabertos = 0
    mantidos_liberados = 0
    # Quem passou a poder preencher, e quem ja estava preenchido — o aviso ao
    # gerente precisa dos dois: um diz o que fazer, o outro o que conferir.
    lista_abertos, lista_preenchidos, lista_liberados = [], [], []
    for c in condos:
        existing = db.table("edicoes_mensais").select("id, status") \
            .eq("condominio_id", c["id"]).eq("ano_referencia", ano).eq("mes_referencia", mes) \
            .limit(1).execute()
        if existing.data:
            row = existing.data[0]
            if row["status"] != "em_edicao" and not pode_reabrir:
                # Já liberado e abertura em massa: não mexe (não volta pro gerente)
                mantidos_liberados += 1
                lista_liberados.append({"condominio_id": c["id"], "gerente_id": c.get("gerente_id")})
            # Se ja existe e nao esta em_edicao, reabre
            elif row["status"] != "em_edicao":
                db.table("edicoes_mensais").update({
                    "status": "em_edicao",
                    "aberto_por": user["id"],
                    "aberto_em": "now()",
                    "liberado_em": None,
                    "reabertura_solicitada_em": None,
                    "reabertura_motivo": None,
                    "reabertura_respondida_em": None,
                    "reabertura_respondida_por": None,
                    "reabertura_aprovada": None,
                }).eq("id", row["id"]).execute()
                reabertos += 1
                lista_abertos.append({"condominio_id": c["id"], "gerente_id": c.get("gerente_id")})
                # Auditoria: registra a reabertura na Fila de Conferência (best-effort)
                try:
                    pac = db.table("emissoes_pacotes").select("id") \
                        .eq("condominio_id", c["id"]).eq("mes_referencia", mes).eq("ano_referencia", ano) \
                        .limit(1).execute().data
                    db.table("emissoes_ocorrencias").insert({
                        "pacote_id": pac[0]["id"] if pac else None,
                        "condominio_id": c["id"],
                        "tipo": "solicitacao",
                        "status": "aberta",
                        "descricao": f"Mês reaberto para edição (ref. {mes:02d}/{ano}).",
                        "origem": "reabertura",
                        "criado_por": user["id"],
                        "criado_por_role": user.get("role") or "master",
                    }).execute()
                except Exception as _e:
                    print(f"[abrir_edicao] falha ao registrar reabertura: {_e}")
        else:
            db.table("edicoes_mensais").insert({
                "condominio_id": c["id"],
                "gerente_id": c.get("gerente_id"),
                "mes_referencia": mes,
                "ano_referencia": ano,
                "status": "em_edicao",
                "aberto_por": user["id"],
            }).execute()
            criados += 1
            lista_abertos.append({"condominio_id": c["id"], "gerente_id": c.get("gerente_id")})

    # Quem abriu mas ja tinha valor digitado: e o que a gerente adiantou e
    # precisa conferir. Sai da lista de abertos porque o aviso dele e outro.
    preenchidos_ids = set()
    try:
        alvo = [e["condominio_id"] for e in lista_abertos]
        if alvo:
            rc = (db.table("rateios_config").select("id, condominio_id")
                    .in_("condominio_id", alvo).execute().data or [])
            por_rateio = {r["id"]: r["condominio_id"] for r in rc}
            chaves = list(por_rateio.keys())
            for i in range(0, len(chaves), 200):
                vs = (db.table("rateios_valores").select("rateio_id, valor")
                        .in_("rateio_id", chaves[i:i + 200])
                        .eq("month", mes).eq("ano", ano).execute().data or [])
                for v in vs:
                    try:
                        n = float(str(v.get("valor") or "0").replace(",", "."))
                    except (TypeError, ValueError):
                        n = 0.0
                    if n > 0:
                        preenchidos_ids.add(por_rateio[v["rateio_id"]])
    except Exception as e:
        print(f"[abrir_edicao] preenchidos falhou (segue sem): {e}")

    lista_preenchidos = [e for e in lista_abertos if e["condominio_id"] in preenchidos_ids]
    lista_abertos = [e for e in lista_abertos if e["condominio_id"] not in preenchidos_ids]

    _notificar_gerente_abertura(db, mes, ano, lista_abertos, lista_preenchidos, lista_liberados,
                                user.get("full_name") or "A administração")

    return {"ok": True, "mes": mes, "ano": ano, "criados": criados, "reabertos": reabertos,
            "mantidos_liberados": mantidos_liberados, "total_condos": len(condos)}


@router.get("/edicoes-mensais")
def api_listar_edicoes(
    status: Optional[str] = None,
    ano: Optional[int] = None,
    mes: Optional[int] = None,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db),
):
    """Lista edicoes. Gerente ve so as suas. Master/emissor/supervisor veem tudo."""
    # O gerente vem embutido porque quem supervisiona ve a fila INTEIRA — sem o nome
    # nao da para saber de quem e cada planilha. `edicoes_mensais.gerente_id` tem FK
    # real para `gerentes` (0034), entao sai na mesma consulta, sem chamada extra.
    SEL_COM_GERENTE = "*, condominios(name), gerentes(id, nome, profiles!gerentes_profile_id_fkey(full_name))"
    SEL_SIMPLES = "*, condominios(name)"

    def _montar(selecao):
        q = db.table("edicoes_mensais").select(selecao)
        if status:
            q = q.eq("status", status)
        if ano:
            q = q.eq("ano_referencia", ano)
        if mes:
            q = q.eq("mes_referencia", mes)

        # Assistente entra aqui junto com o gerente.
        #
        # Era so `== "gerente"`, e o assistente abria o painel puxando a fila
        # INTEIRA — as planilhas de todos os gerentes. Nao aparecia na tela
        # (a lista de condominios ja vem recortada), mas o dado chegava ao
        # navegador dele. `carteira_gerente_id` resolve os dois casos: a
        # propria carteira do gerente, e a do gerente a que o assistente esta
        # vinculado (profiles.gerente_id, 0057).
        if user.get("role") in ("gerente", "assistente"):
            g_id = carteira_gerente_id(db, user)
            if not g_id:
                return None
            q = q.eq("gerente_id", g_id)

        return q.order("ano_referencia", desc=True) \
                .order("mes_referencia", desc=True) \
                .order("aberto_em", desc=True)

    q = _montar(SEL_COM_GERENTE)
    if q is None:
        return {"edicoes": []}
    try:
        return {"edicoes": q.execute().data or []}
    except Exception as e:
        # O nome do gerente e um conforto: se o embed falhar, a fila ainda carrega.
        print(f"[edicoes-mensais] embed de gerente falhou (segue sem): {type(e).__name__}")
        q = _montar(SEL_SIMPLES)
        return {"edicoes": (q.execute().data or []) if q is not None else []}


class LiberarSchema(BaseModel):
    # Marcado pelo gerente quando ele confirma que a planilha vazia é intencional.
    forcar: bool = False


@router.post("/edicoes-mensais/{edicao_id}/liberar")
def api_liberar_edicao(edicao_id: str, data: Optional[LiberarSchema] = None,
                       user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Gerente finaliza a edicao de UM condominio."""
    role = user.get("role")
    if role not in ("master", "gerente"):
        raise HTTPException(403, "Sem permissao")

    edi_res = db.table("edicoes_mensais").select("*").eq("id", edicao_id).limit(1).execute()
    if not edi_res.data:
        raise HTTPException(404, "Edicao nao encontrada")
    edi = edi_res.data[0]

    if role == "gerente":
        g_id = get_gerente_id(db, user["id"])
        if edi.get("gerente_id") != g_id:
            raise HTTPException(403, "Voce nao gerencia este condominio")

    # Assembleia prevista trava o mes dela e os seguintes. A recusa nomeia qual
    # e diz o que fazer — uma recusa que so diz "nao" faz a pessoa tentar de
    # novo em vez de resolver.
    alt = _alteracao_que_trava(db, edi["condominio_id"], edi["ano_referencia"], edi["mes_referencia"])
    if alt:
        raise HTTPException(409, _texto_da_trava(alt, edi["mes_referencia"]))

    if edi["status"] != "em_edicao":
        raise HTTPException(400, f"Status atual nao permite liberacao: {edi['status']}")

    # Qualidade: não deixa sair planilha em branco (a menos que o gerente insista).
    if not (data and data.forcar) and _meses_em_branco(db, [edi]):
        mes_lbl = f"{_MES_NOME[edi['mes_referencia']]}/{edi['ano_referencia']}"
        raise HTTPException(422, f"A planilha de {mes_lbl} está sem nenhum valor preenchido. "
                                 "Preencha antes de liberar, ou confirme que é intencional.")

    from datetime import datetime, timezone
    db.table("edicoes_mensais").update({
        "status": "edicao_finalizada",
        "liberado_em": datetime.now(timezone.utc).isoformat(),
    }).eq("id", edicao_id).execute()
    _notificar_emissao_liberacao(db, [edi], user.get("full_name") or "Um gerente")
    return {"ok": True}


class LiberarTodosSchema(BaseModel):
    mes: Optional[int] = None
    ano: Optional[int] = None
    ids: Optional[List[str]] = None   # libera exatamente estas edições (vários MESES de uma vez)
    forcar: bool = False              # ignora a trava de planilha em branco


@router.post("/edicoes-mensais/liberar-todos")
def api_liberar_todos(data: LiberarTodosSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Gerente libera todos os seus condos do periodo de uma vez."""
    role = user.get("role")
    if role not in ("master", "gerente"):
        raise HTTPException(403, "Sem permissao")

    from datetime import datetime, timezone

    # Modo "vários meses": o gerente manda as edições abertas que quer liberar de uma vez
    # (a previsão que ele preencheu), em vez de confirmar mês a mês.
    if data.ids:
        q = db.table("edicoes_mensais").select(
            "id, gerente_id, status, condominio_id, mes_referencia, ano_referencia"
        ).in_("id", data.ids)
        if role == "gerente":
            g_id = get_gerente_id(db, user["id"])
            if not g_id:
                return {"ok": True, "liberados": 0}
            q = q.eq("gerente_id", g_id)
        rows = [e for e in (q.execute().data or []) if e.get("status") == "em_edicao"]
        if not rows:
            return {"ok": True, "liberados": 0}

        # Qualidade: mês sem nenhum valor não sai junto no bolo. Fica de fora e é
        # devolvido nomeado, para o gerente ver exatamente qual precisa preencher.
        em_branco = set() if data.forcar else _meses_em_branco(db, rows)

        # A trava por assembleia vale aqui tambem — e nao e ignorada por
        # `forcar`. Forcar existe para liberar mes em branco, nao para passar
        # por cima de uma assembleia que ainda vai acontecer.
        travados_lote = []
        def _travado(e):
            alt = _alteracao_que_trava(db, e["condominio_id"], e["ano_referencia"], e["mes_referencia"])
            if alt:
                travados_lote.append({
                    "mes": e["mes_referencia"], "ano": e["ano_referencia"],
                    "alteracao_id": alt["id"], "tipo": alt["tipo"],
                    "mes_da_alteracao": alt["mes_referencia"],
                    "data_evento": alt.get("data_evento"),
                    "mensagem": _texto_da_trava(alt, e["mes_referencia"]),
                })
                return True
            return False

        liberar = [e for e in rows
                   if (e["condominio_id"], e["ano_referencia"], e["mes_referencia"]) not in em_branco
                   and not _travado(e)]
        pulados = [f"{_MES_NOME[e['mes_referencia']]}/{e['ano_referencia']}"
                   for e in rows
                   if (e["condominio_id"], e["ano_referencia"], e["mes_referencia"]) in em_branco]
        if not liberar:
            if travados_lote:
                # Travado nao e o mesmo que vazio, e a mensagem tem de dizer o
                # que resolve: marcar a assembleia como realizada.
                raise HTTPException(409, travados_lote[0]["mensagem"])
            raise HTTPException(422, "Nenhum mês tinha valor preenchido: " + ", ".join(sorted(set(pulados))))

        db.table("edicoes_mensais").update({
            "status": "edicao_finalizada",
            "liberado_em": datetime.now(timezone.utc).isoformat(),
        }).in_("id", [e["id"] for e in liberar]).execute()
        _notificar_emissao_liberacao(db, liberar, user.get("full_name") or "Um gerente")
        return {"ok": True, "liberados": len(liberar),
                "pulados_em_branco": sorted(set(pulados)),
                "travados": travados_lote}

    mes_padrao, ano_padrao = _mes_alvo_padrao()
    mes = data.mes or mes_padrao
    ano = data.ano or ano_padrao

    q = db.table("edicoes_mensais").select("id") \
        .eq("status", "em_edicao") \
        .eq("ano_referencia", ano) \
        .eq("mes_referencia", mes)

    if role == "gerente":
        g_id = get_gerente_id(db, user["id"])
        if not g_id:
            return {"ok": True, "liberados": 0}
        q = q.eq("gerente_id", g_id)

    res = q.execute()
    ids = [e["id"] for e in (res.data or [])]
    if not ids:
        return {"ok": True, "liberados": 0}

    db.table("edicoes_mensais").update({
        "status": "edicao_finalizada",
        "liberado_em": datetime.now(timezone.utc).isoformat(),
    }).in_("id", ids).execute()
    return {"ok": True, "liberados": len(ids)}


class SolicitarReaberturaSchema(BaseModel):
    motivo: str


def _alteracao_que_trava(db: Client, condominio_id: str, ano: int, mes: int):
    """A alteracao prevista que impede liberar este mes — ou None.

    AGO, AGE e reuniao decidem o orcamento. Liberar o mes DELA, ou qualquer mes
    DEPOIS dela, e emitir o valor que a assembleia esta prestes a mudar. Por
    isso a trava vale do mes da alteracao em diante.

    A trava cai quando a alteracao for marcada como realizada — nao pelo
    calendario. Assembleia adia, e uma trava que se solta sozinha na data
    marcada solta justamente no mes em que ela foi adiada.
    """
    try:
        rows = (db.table("alteracoes_rateio")
                  .select("id, tipo, mes_referencia, data_evento, descricao, status")
                  .eq("condominio_id", condominio_id)
                  .eq("ano_referencia", ano)
                  .eq("status", "prevista")
                  .lte("mes_referencia", mes)
                  .order("mes_referencia").execute().data or [])
        return rows[0] if rows else None
    except Exception as e:
        print(f"[trava] consulta de alteracoes falhou (segue sem travar): {e}")
        return None


def _texto_da_trava(alt: dict, mes: int) -> str:
    quando = ""
    if alt.get("data_evento"):
        try:
            d = str(alt["data_evento"])[:10].split("-")
            quando = f" de {d[2]}/{d[1]}"
        except Exception:
            quando = ""
    onde = _MES_NOME[alt["mes_referencia"]]
    alvo = _MES_NOME[mes]
    mesmo_mes = alt["mes_referencia"] == mes
    return (
        f"{alvo} esta travado pela {alt['tipo']}{quando}, marcada em {onde} e ainda prevista."
        + ("" if mesmo_mes else " A trava vale do mes da assembleia em diante.")
        + " Se ela ja aconteceu, marque como realizada — ai o mes destrava."
    )


class MotivoSemValoresSchema(BaseModel):
    condominio_id: str
    mes: int
    ano: int
    motivo: Optional[str] = None      # None limpa
    detalhe: Optional[str] = None


@router.post("/edicoes-mensais/motivo-sem-valores")
def api_motivo_sem_valores(
    data: MotivoSemValoresSchema,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db),
):
    """Por que este mes ficou sem valores (0108).

    Mes vazio nao e liberado calado: alguem vai perguntar por que dezembro esta
    zerado, e a resposta tem de estar no sistema, nao na memoria de quem
    preencheu. Cria a edicao se ela ainda nao existe — o mes pode nem ter sido
    aberto, e e justamente ai que a explicacao importa.
    """
    require_role(user, ["master", "gerente", "assistente"])

    if user["role"] in ("gerente", "assistente"):
        if data.condominio_id not in carteira_condo_ids(db, user):
            raise HTTPException(403, "Este condominio nao esta na sua carteira.")

    existe = (db.table("edicoes_mensais").select("id, status")
                .eq("condominio_id", data.condominio_id)
                .eq("mes_referencia", data.mes).eq("ano_referencia", data.ano)
                .limit(1).execute().data or [])

    payload = {
        "motivo_sem_valores": (data.motivo or "").strip() or None,
        "motivo_detalhe": (data.detalhe or "").strip() or None,
        "motivo_por": user["id"],
    }

    if existe:
        db.table("edicoes_mensais").update(payload).eq("id", existe[0]["id"]).execute()
        return {"ok": True, "criada": False}

    c = (db.table("condominios").select("gerente_id")
           .eq("id", data.condominio_id).maybe_single().execute().data) or {}
    from datetime import datetime, timezone
    db.table("edicoes_mensais").insert({
        **payload,
        "condominio_id": data.condominio_id,
        "gerente_id": c.get("gerente_id"),
        "mes_referencia": data.mes,
        "ano_referencia": data.ano,
        "status": "em_edicao",
        "aberto_por": user["id"],
        "aberto_em": datetime.now(timezone.utc).isoformat(),
        # O carimbo do motivo e do trigger no UPDATE; no INSERT vai explicito.
        "motivo_em": datetime.now(timezone.utc).isoformat(),
    }).execute()
    return {"ok": True, "criada": True}


class PreAprovarSchema(BaseModel):
    condominio_id: str
    competencias: list          # [{"mes": 10, "ano": 2026}, ...]


@router.post("/edicoes-mensais/pre-aprovar")
def api_pre_aprovar(
    data: PreAprovarSchema,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db),
):
    """O gerente aprova meses que o master ainda nao abriu.

    Eles trabalham com previsao orcamentaria anual: preenchem outubro, novembro
    e dezembro de um condominio de uma vez. Hoje so podiam liberar mes que ja
    tivesse quadro aberto, entao a previsao ficava parada esperando o master
    abrir para so entao alguem confirmar — condominio por condominio, mes a mes,
    todo mes, para um trabalho que ja estava feito.

    Aqui a edicao nasce ja finalizada. Quando o master abrir o mes em massa
    depois, o que ja esta liberado e preservado (a abertura em massa nao reabre
    o que o gerente liberou).

    Mes sem nenhum valor NAO e aprovado: aprovar planilha vazia e dizer que
    conferiu o que nao existe. Volta nomeado, para o gerente ver qual falta.
    """
    require_role(user, ["master", "gerente", "assistente"])

    # Gerente e assistente so na propria carteira.
    if user["role"] in ("gerente", "assistente"):
        if data.condominio_id not in carteira_condo_ids(db, user):
            raise HTTPException(403, "Este condominio nao esta na sua carteira.")

    g_id = None
    if user["role"] in ("gerente", "assistente"):
        g_id = carteira_gerente_id(db, user)
    if not g_id:
        c = (db.table("condominios").select("gerente_id")
               .eq("id", data.condominio_id).maybe_single().execute().data) or {}
        g_id = c.get("gerente_id")

    comps = []
    for c in (data.competencias or []):
        try:
            mes, ano = int(c["mes"]), int(c["ano"])
        except Exception:
            continue
        if 1 <= mes <= 12:
            comps.append((mes, ano))
    if not comps:
        raise HTTPException(400, "Nenhuma competencia valida foi enviada.")

    # Quais tem valor preenchido. `_meses_em_branco` espera linhas no formato da
    # edicao — monto o mesmo formato para reusar a regra em vez de reescreve-la.
    fingidas = [{"condominio_id": data.condominio_id, "mes_referencia": m, "ano_referencia": a}
                for m, a in comps]
    em_branco = _meses_em_branco(db, fingidas)

    from datetime import datetime, timezone
    agora = datetime.now(timezone.utc).isoformat()
    aprovadas, puladas, ja_estavam = [], [], []

    travados = []
    for mes, ano in comps:
        if (data.condominio_id, ano, mes) in em_branco:
            puladas.append(f"{_MES_NOME[mes]}/{ano}")
            continue

        alt = _alteracao_que_trava(db, data.condominio_id, ano, mes)
        if alt:
            travados.append({
                "mes": mes, "ano": ano,
                "alteracao_id": alt["id"], "tipo": alt["tipo"],
                "mes_da_alteracao": alt["mes_referencia"],
                "data_evento": alt.get("data_evento"),
                "descricao": alt.get("descricao"),
                "mensagem": _texto_da_trava(alt, mes),
            })
            continue

        existe = (db.table("edicoes_mensais")
                    .select("id, status")
                    .eq("condominio_id", data.condominio_id)
                    .eq("mes_referencia", mes).eq("ano_referencia", ano)
                    .limit(1).execute().data or [])

        if existe:
            atual = existe[0]
            if atual["status"] == "edicao_finalizada":
                ja_estavam.append(f"{_MES_NOME[mes]}/{ano}")
                continue
            # Reabertura pedida e ainda nao respondida nao vira aprovacao por
            # atalho: quem pediu para reabrir espera uma resposta, nao um
            # carimbo por cima.
            if atual["status"] == "reabertura_solicitada":
                puladas.append(f"{_MES_NOME[mes]}/{ano} (reabertura pendente)")
                continue
            db.table("edicoes_mensais").update({
                "status": "edicao_finalizada", "liberado_em": agora,
            }).eq("id", atual["id"]).execute()
        else:
            db.table("edicoes_mensais").insert({
                "condominio_id": data.condominio_id,
                "gerente_id": g_id,
                "mes_referencia": mes,
                "ano_referencia": ano,
                "status": "edicao_finalizada",
                "aberto_por": user["id"],
                "aberto_em": agora,
                "liberado_em": agora,
            }).execute()

        aprovadas.append({"condominio_id": data.condominio_id,
                          "mes_referencia": mes, "ano_referencia": ano})

    if aprovadas:
        _notificar_emissao_liberacao(db, aprovadas, user.get("full_name") or "Um gerente")

    return {
        "ok": True,
        "aprovadas": len(aprovadas),
        "meses": [f"{_MES_NOME[a['mes_referencia']]}/{a['ano_referencia']}" for a in aprovadas],
        "puladas_em_branco": sorted(set(puladas)),
        "ja_aprovadas": sorted(set(ja_estavam)),
        # Cada mes travado volta com a alteracao que o trava — a tela abre a
        # marcacao dela ja aberta, para o gerente finalizar ali mesmo em vez de
        # sair procurando onde se faz isso.
        "travados": travados,
    }


@router.post("/edicoes-mensais/{edicao_id}/solicitar-reabertura")
def api_solicitar_reabertura(edicao_id: str, data: SolicitarReaberturaSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    role = user.get("role")
    if role not in ("master", "gerente"):
        raise HTTPException(403, "Sem permissao")
    if not data.motivo or not data.motivo.strip():
        raise HTTPException(400, "Motivo e obrigatorio")

    edi_res = db.table("edicoes_mensais").select("*").eq("id", edicao_id).limit(1).execute()
    if not edi_res.data:
        raise HTTPException(404, "Edicao nao encontrada")
    edi = edi_res.data[0]

    if role == "gerente":
        g_id = get_gerente_id(db, user["id"])
        if edi.get("gerente_id") != g_id:
            raise HTTPException(403, "Voce nao gerencia este condominio")

    if edi["status"] != "edicao_finalizada":
        raise HTTPException(400, "Reabertura so para edicoes finalizadas")

    from datetime import datetime, timezone
    db.table("edicoes_mensais").update({
        "status": "reabertura_solicitada",
        "reabertura_solicitada_em": datetime.now(timezone.utc).isoformat(),
        "reabertura_motivo": data.motivo.strip(),
    }).eq("id", edicao_id).execute()
    return {"ok": True}


class ResponderReaberturaSchema(BaseModel):
    aprovar: bool


_MES_NOME = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
             'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']


def _meses_em_branco(db, edicoes):
    """Dentre as edições, quais têm a planilha do mês SEM NENHUM valor preenchido.

    Liberar um mês em branco é o erro caro: a emissão só descobre quando vai
    montar o boleto, já fora do prazo.

    ⚠️ A primeira versão desta função ia de `processos` para `rateios_config` por
    `processo_id` — coluna REMOVIDA na 0011, que trocou a chave para
    `condominio_id`. A consulta estourava, o except engolia, e a trava respondia
    "está tudo preenchido" para todo mundo: nunca bloqueou nada. É a Armadilha 1
    do docs/ESQUEMA-BANCO.md, cometida no mesmo dia em que foi escrita.
    Agora vai direto por condominio_id — duas consultas, sem passar por processos.
    """
    if not edicoes:
        return set()
    condo_ids = list({e["condominio_id"] for e in edicoes})
    try:
        cfgs = db.table("rateios_config").select("id, condominio_id") \
            .in_("condominio_id", condo_ids).execute().data or []
        if not cfgs:
            # Nenhuma verba configurada = planilha vazia por definição.
            return {(e["condominio_id"], e["ano_referencia"], e["mes_referencia"]) for e in edicoes}
        cfg_condo = {c["id"]: c["condominio_id"] for c in cfgs}
        anos = list({e["ano_referencia"] for e in edicoes})
        vals = db.table("rateios_valores").select("rateio_id, month, ano, valor") \
            .in_("rateio_id", list(cfg_condo)).in_("ano", anos).execute().data or []
    except Exception as e:
        print(f"[liberar] checagem de preenchimento indisponível: {type(e).__name__}: {e}")
        return set()   # na dúvida não bloqueia o gerente

    # (condominio, ano, mes) com ao menos um valor preenchido. O ano entra na
    # chave: sem ele, valor de 2025 faria o mês de 2026 passar por preenchido.
    preenchidos = set()
    for v in vals:
        cid = cfg_condo.get(v.get("rateio_id"))
        if not cid:
            continue
        bruto = (v.get("valor") or "").strip()
        if not bruto or bruto in ("0", "0.00", "0,00", "R$ 0,00"):
            continue
        preenchidos.add((cid, v.get("ano"), v.get("month")))

    return {
        (e["condominio_id"], e["ano_referencia"], e["mes_referencia"])
        for e in edicoes
        if (e["condominio_id"], e["ano_referencia"], e["mes_referencia"]) not in preenchidos
    }


def _notificar_gerente_abertura(db, mes, ano, abertos, ja_preenchidos, ja_liberados, autor_nome):
    """Avisa o gerente que o mes abriu — e o que ja estava preenchido.

    Sem isto, abrir o mes era um evento invisivel: o gerente so descobria
    entrando na tela por conta propria. E quando ele ja tinha adiantado a
    previsao, ninguem lhe dizia que aqueles valores continuam la esperando
    conferencia — a lista de "ja preenchidos" existe justamente para ele
    revisar em vez de assumir que esta tudo certo.

    `abertos` e `ja_preenchidos` sao listas de {condominio_id, gerente_id}.
    """
    if not abertos and not ja_preenchidos and not ja_liberados:
        return
    try:
        todos = abertos + ja_preenchidos + ja_liberados
        ids = list({e["condominio_id"] for e in todos})
        nomes = {c["id"]: c["name"] for c in
                 (db.table("condominios").select("id, name").in_("id", ids).execute().data or [])}

        # Um aviso por gerente, nao um por condominio: trinta notificacoes de
        # uma vez viram ruido e a pessoa para de olhar o sino.
        por_gerente = {}
        for e in todos:
            g = e.get("gerente_id")
            if g:
                por_gerente.setdefault(g, {"abriu": [], "preenchidos": [], "liberados": []})
        for chave, origem in (("abriu", abertos), ("preenchidos", ja_preenchidos), ("liberados", ja_liberados)):
            for e in origem:
                if e.get("gerente_id"):
                    por_gerente[e["gerente_id"]][chave].append(nomes.get(e["condominio_id"], "condominio"))

        # gerentes.id -> profile do gerente
        gs = (db.table("gerentes").select("id, profile_id")
                .in_("id", list(por_gerente.keys())).execute().data or []) if por_gerente else []
        perfil = {g["id"]: g.get("profile_id") for g in gs}

        rotulo = f"{_MES_NOME[mes]}/{ano}"
        for gid, dados in por_gerente.items():
            pid = perfil.get(gid)
            if not pid:
                continue   # gerente-fantasma, sem login: nao ha quem avisar
            n_abriu = len(dados["abriu"])
            n_prontos = len(dados["preenchidos"])

            n_liberados = len(dados["liberados"])

            # Nomeia, nao so conta.
            #
            # "12 ja liberados" nao ajuda ninguem: o gerente precisa saber QUAIS
            # nao voltam para ele. O nome do condominio ja comeca pelo codigo
            # ("482 - ED. VITORIA REGIA"), entao nomear resolve nome e numero de
            # uma vez.
            def _lista(nomes_lista, teto=10):
                ordenados = sorted(nomes_lista)
                if len(ordenados) <= teto:
                    return ", ".join(ordenados)
                return ", ".join(ordenados[:teto]) + f" e mais {len(ordenados) - teto}"

            titulo = f"{rotulo} aberto para preenchimento"
            partes = []
            if n_abriu:
                partes.append(f"{n_abriu} para preencher")
            if n_liberados:
                partes.append(
                    f"{n_liberados} já liberado{'s' if n_liberados != 1 else ''}, não volta{'m' if n_liberados != 1 else ''} para você: "
                    f"{_lista(dados['liberados'])}"
                )
            if n_prontos:
                partes.append(
                    f"{n_prontos} já preenchido{'s' if n_prontos != 1 else ''}, confira antes de liberar: "
                    f"{_lista(dados['preenchidos'])}"
                )
            mensagem = f"{autor_nome} abriu {rotulo}. " + ". ".join(partes) + "."

            # O e-mail recebe os mesmos tres grupos em BLOCOS, com uma tarja de
            # cor cada um — a cor diz o que fazer: azul preencher, verde nao e
            # mais com voce, ambar conferir. Quem abre no celular entende sem
            # ler tudo.
            #
            # O sino continua com a linha corrida: la o espaco e esse, e HTML na
            # `mensagem` apareceria como tag na tela.
            def _bloco(cor, titulo_b, corpo_b, nota=None):
                h = (f'<div style="border-left:3px solid {cor};padding:2px 0 2px 14px;margin-bottom:16px;">'
                     f'<p style="margin:0 0 2px;font-size:15px;font-weight:bold;color:#0f1a3c;">{titulo_b}</p>'
                     f'<p style="margin:0;font-size:13px;color:#334155;line-height:1.7;">{corpo_b}</p>')
                if nota:
                    h += f'<p style="margin:4px 0 0;font-size:12px;color:#92700e;line-height:1.6;">{nota}</p>'
                return h + '</div>'

            html = (f'<p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.6;">'
                    f'{autor_nome} abriu o mês para a sua carteira.</p>')
            if n_abriu:
                html += _bloco("#3b6fe0", f"{n_abriu} para preencher",
                               "Estão vazios e esperando os valores.")
            if n_liberados:
                html += _bloco("#16a34a",
                               f"{n_liberados} já liberado{'s' if n_liberados != 1 else ''} — não volta{'m' if n_liberados != 1 else ''} para você",
                               _lista(dados["liberados"], teto=20).replace(", ", "<br>"))
            if n_prontos:
                html += _bloco("#ea9214",
                               f"{n_prontos} já preenchido{'s' if n_prontos != 1 else ''} — confira antes de liberar",
                               _lista(dados["preenchidos"], teto=20).replace(", ", "<br>"),
                               "Os valores foram digitados antes de o mês abrir. Confira se ainda valem.")
            html += ('<p style="margin:18px 0 0;font-size:12px;color:#94a3b8;line-height:1.6;">'
                     'Sem liberação ninguém emite — nem agora, nem quando o mês chegar.</p>')

            # O teto e 1200, nao 240: aqui a lista de nomes E a informacao, e
            # cortar em 240 devolveria o problema que este aviso veio resolver.
            db.table("notificacoes").insert({
                "user_id": pid, "tipo": "mes_aberto",
                "titulo": titulo[:120], "mensagem": mensagem[:1200],
                "email_html": html,
                "link": "/aprovacoes",
            }).execute()
    except Exception as e:
        # Aviso nunca derruba a abertura.
        print(f"[abrir_edicao] notificacao ao gerente falhou: {type(e).__name__}: {e}")


def _notificar_emissao_liberacao(db, edicoes, autor_nome):
    """Avisa a emissão (master + departamento) que planilhas foram liberadas.

    Antes disso ninguém era avisado: a emissão só descobria abrindo a tela e
    reparando que o status tinha mudado."""
    if not edicoes:
        return
    try:
        nomes = {}
        for c in (db.table("condominios").select("id, name")
                  .in_("id", list({e["condominio_id"] for e in edicoes})).execute().data or []):
            nomes[c["id"]] = c["name"]

        meses = sorted({(e["ano_referencia"], e["mes_referencia"]) for e in edicoes})
        rotulo_meses = " · ".join(f"{_MES_NOME[m]}/{a}" for a, m in meses[:4])
        if len(meses) > 4:
            rotulo_meses += f" (+{len(meses) - 4})"

        condos = sorted({nomes.get(e["condominio_id"], "condomínio") for e in edicoes})
        if len(condos) == 1:
            titulo = f"Planilha liberada · {condos[0]}"
        else:
            titulo = f"{len(condos)} planilhas liberadas"
        mensagem = f"{autor_nome} liberou {rotulo_meses}."
        if len(condos) > 1:
            mensagem += f" Condomínios: {', '.join(condos[:3])}{'…' if len(condos) > 3 else ''}"

        alvos = db.table("profiles").select("id").in_("role", ["master", "departamento"]).execute().data or []
        for p in alvos:
            db.table("notificacoes").insert({
                "user_id": p["id"], "tipo": "planilha_liberada",
                "titulo": titulo[:120], "mensagem": mensagem[:240],
                "link": "/aprovacoes",
            }).execute()
    except Exception as e:
        # Notificação nunca pode derrubar a liberação em si.
        print(f"[liberar] notificação falhou: {type(e).__name__}")


class AvisarExpedicaoSchema(BaseModel):
    pacote_ids: List[str]


def _notificar_expedicao(db, pacote_ids, autor_nome):
    """Avisa a expedição que há remessa nova para imprimir.

    Até aqui a expedição não era avisada de nada: descobria abrindo a tela e
    reparando que a fila tinha crescido. Como é outro departamento, e não quem
    mexe no sistema o dia inteiro, isso significava boleto parado esperando
    alguém lembrar de olhar.

    Um aviso por AÇÃO, não por pacote: expedir o mês inteiro são 60 pacotes de
    uma vez, e 60 e-mails seriam 60 motivos para criar uma regra de caixa de
    entrada que joga todos fora.
    """
    if not pacote_ids:
        return {"notificados": 0}
    try:
        pacs = (db.table("emissoes_pacotes")
                .select("id, condominio_id, mes_referencia, ano_referencia")
                .in_("id", list(pacote_ids)).execute().data or [])
        if not pacs:
            return {"notificados": 0}

        condos = {}
        condo_ids = list({p["condominio_id"] for p in pacs if p.get("condominio_id")})
        if condo_ids:
            for c in (db.table("condominios").select("id, name, usa_filipeta, prazo_expedicao_dia")
                      .in_("id", condo_ids).execute().data or []):
                condos[c["id"]] = c

        # Quantos arquivos de cada tipo chegaram junto. O número é o que diz se
        # a remessa está inteira — e se a filipeta de quem manda filipeta veio.
        arqs = (db.table("emissoes_arquivos").select("pacote_id, categoria")
                .in_("pacote_id", [p["id"] for p in pacs])
                .in_("categoria", ["boleto", "filipeta"]).execute().data or [])
        por_pacote = {}
        for a in arqs:
            d = por_pacote.setdefault(a["pacote_id"], {"boleto": 0, "filipeta": 0})
            d[a["categoria"]] = d.get(a["categoria"], 0) + 1

        meses = sorted({(p["ano_referencia"], p["mes_referencia"]) for p in pacs})
        rotulo = " · ".join(f"{_MES_NOME[m]}/{a}" for a, m in meses[:3])
        if len(meses) > 3:
            rotulo += f" (+{len(meses) - 3})"

        linhas_dados, faltando, boletos = [], [], 0
        for p in pacs:
            c = condos.get(p.get("condominio_id")) or {}
            nome = c.get("name") or "Condomínio"
            cont = por_pacote.get(p["id"], {"boleto": 0, "filipeta": 0})
            boletos += cont["boleto"]
            linhas_dados.append((nome, cont, c))
            if c.get("usa_filipeta") and not cont["filipeta"]:
                faltando.append(nome)
        linhas_dados.sort(key=lambda x: x[0])
        faltando.sort()

        n = len(pacs)
        titulo = (f"Expedição: {linhas_dados[0][0]}" if n == 1
                  else f"Expedição: {n} condomínios para imprimir")

        def _corta(lista, teto):
            if len(lista) <= teto:
                return ", ".join(lista)
            return ", ".join(lista[:teto]) + f" e mais {len(lista) - teto}"

        mensagem = (f"{autor_nome} expediu {rotulo}. "
                    f"{n} condomínio{'s' if n != 1 else ''}, "
                    f"{boletos} arquivo{'s' if boletos != 1 else ''} de boleto: "
                    f"{_corta([x[0] for x in linhas_dados], 8)}.")
        if faltando:
            mensagem += f" Sem filipeta ({len(faltando)}): {_corta(faltando, 6)}."

        # No e-mail, uma linha por condomínio com o que veio dentro — e a linha
        # de quem deveria ter filipeta e não tem sai destacada, porque é a única
        # que exige alguém fazer alguma coisa antes de imprimir.
        linhas = []
        for nome, cont, c in linhas_dados:
            partes = [f"{cont['boleto']} boleto{'s' if cont['boleto'] != 1 else ''}"]
            if cont["filipeta"]:
                partes.append(f"{cont['filipeta']} filipeta{'s' if cont['filipeta'] != 1 else ''}")
            detalhe = " + ".join(partes)
            alerta = ""
            if c.get("usa_filipeta") and not cont["filipeta"]:
                alerta = ' <span style="color:#b91c1c;font-weight:bold;">— falta a filipeta</span>'
            prazo = ""
            if c.get("prazo_expedicao_dia"):
                prazo = (' <span style="color:#92700e;">· entregar até o dia '
                         f'{c["prazo_expedicao_dia"]}</span>')
            linhas.append(f'<span style="color:#0f1a3c;font-weight:bold;">{nome}</span> '
                          f'<span style="color:#64748b;">{detalhe}</span>{alerta}{prazo}')

        html = (f'<p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.6;">'
                f'{autor_nome} expediu {rotulo}. '
                f'{n} condomínio{"s" if n != 1 else ""} '
                f'{"entraram" if n != 1 else "entrou"} na fila de impressão.</p>'
                f'<div style="border-left:3px solid #3b6fe0;padding:2px 0 2px 14px;margin-bottom:16px;">'
                f'<p style="margin:0;font-size:13px;color:#334155;line-height:1.9;">'
                + "<br>".join(linhas[:30])
                + (f'<br><span style="color:#94a3b8;">e mais {len(linhas) - 30}</span>'
                   if len(linhas) > 30 else '')
                + '</p></div>')
        if faltando:
            html += (f'<div style="border-left:3px solid #dc2626;padding:2px 0 2px 14px;margin-bottom:16px;">'
                     f'<p style="margin:0 0 2px;font-size:15px;font-weight:bold;color:#0f1a3c;">'
                     f'{len(faltando)} sem filipeta</p>'
                     f'<p style="margin:0;font-size:13px;color:#334155;line-height:1.7;">'
                     f'{"<br>".join(faltando[:20])}</p>'
                     f'<p style="margin:4px 0 0;font-size:12px;color:#92700e;line-height:1.6;">'
                     f'Estes condomínios mandam filipeta todo mês e ela não veio nesta remessa. '
                     f'Cobre antes de imprimir.</p></div>')
        html += ('<p style="margin:18px 0 0;font-size:12px;color:#94a3b8;line-height:1.6;">'
                 'A fila fica em Central de Emissões, aba Expedição, em duas etapas: '
                 'o botão Impresso dá a baixa da impressão, e o botão Entregue fecha '
                 'a remessa quando ela chega ao cliente.</p>')

        alvos = (db.table("profiles").select("id").eq("role", "expedicao").execute().data or [])
        for p in alvos:
            db.table("notificacoes").insert({
                "user_id": p["id"], "tipo": "expedicao_nova",
                "titulo": titulo[:120], "mensagem": mensagem[:1200],
                "email_html": html,
                "link": "/central-emissoes?tab=expedicao",
            }).execute()
        return {"notificados": len(alvos), "sem_filipeta": faltando}
    except Exception as e:
        # Aviso nunca derruba a expedição em si.
        print(f"[expedicao] aviso falhou: {type(e).__name__}: {e}")
        return {"notificados": 0, "erro": type(e).__name__}


class EntregaSchema(BaseModel):
    pacote_ids: List[str]
    recebido_por: Optional[str] = None
    desfazer: Optional[bool] = False


def _notificar_entrega(db, pacs, condos, autor_nome, recebido_por):
    """Avisa o gerente que a remessa dele chegou ao condomínio.

    O gerente é quem o síndico liga para cobrar. Até aqui ele não tinha como
    responder "chegou terça, quem recebeu foi a portaria" — a informação existia
    só na cabeça de quem entregou.

    Um aviso por gerente, não por condomínio: a expedição entrega a rua inteira
    de uma vez."""
    try:
        por_gerente = {}
        for p in pacs:
            c = condos.get(p.get("condominio_id")) or {}
            g = c.get("gerente_id")
            if not g:
                continue
            por_gerente.setdefault(g, []).append(c.get("name") or "Condomínio")
        if not por_gerente:
            return 0

        perfil = {}
        for g in (db.table("gerentes").select("id, profile_id")
                  .in_("id", list(por_gerente.keys())).execute().data or []):
            if g.get("profile_id"):
                perfil[g["id"]] = g["profile_id"]

        meses = sorted({(p["ano_referencia"], p["mes_referencia"]) for p in pacs})
        rotulo = " · ".join(f"{_MES_NOME[m]}/{a}" for a, m in meses[:3])

        quem = (recebido_por or "").strip()
        enviados = 0
        for gid, nomes in por_gerente.items():
            pid = perfil.get(gid)
            if not pid:
                continue
            nomes = sorted(set(nomes))
            n = len(nomes)
            titulo = (f"Entregue: {nomes[0]}" if n == 1
                      else f"{n} condomínios entregues")
            mensagem = (f"{autor_nome} entregou {rotulo}: {', '.join(nomes[:8])}"
                        f"{f' e mais {n - 8}' if n > 8 else ''}."
                        + (f" Recebido por {quem}." if quem else ""))

            html = (f'<p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.6;">'
                    f'{autor_nome} entregou {rotulo} no condomínio.</p>'
                    f'<div style="border-left:3px solid #16a34a;padding:2px 0 2px 14px;margin-bottom:16px;">'
                    f'<p style="margin:0 0 2px;font-size:15px;font-weight:bold;color:#0f1a3c;">'
                    f'{n} entregue{"s" if n != 1 else ""}</p>'
                    f'<p style="margin:0;font-size:13px;color:#334155;line-height:1.8;">'
                    f'{"<br>".join(nomes[:20])}</p>'
                    + (f'<p style="margin:6px 0 0;font-size:12px;color:#64748b;">'
                       f'Recebido por {quem}.</p>' if quem else '')
                    + '</div>'
                    '<p style="margin:18px 0 0;font-size:12px;color:#94a3b8;line-height:1.6;">'
                    'Se o síndico perguntar quando chegou, a data e quem recebeu ficam '
                    'registrados na emissão.</p>')

            db.table("notificacoes").insert({
                "user_id": pid, "tipo": "emissao_entregue",
                "titulo": titulo[:120], "mensagem": mensagem[:1200],
                "email_html": html,
                "link": "/central-emissoes",
            }).execute()
            enviados += 1
        return enviados
    except Exception as e:
        print(f"[expedicao/entregar] aviso ao gerente falhou: {type(e).__name__}: {e}")
        return 0


@router.post("/expedicao/entregar")
def api_expedicao_entregar(data: EntregaSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Marca a remessa como entregue ao cliente — o fim do trabalho.

    A escrita vem para o servidor de propósito: a data é do servidor, não do
    relógio de quem clicou, e o nome de quem entregou sai da sessão em vez de
    ser digitado. Registro de entrega é o tipo de dado que alguém vai querer
    contestar um dia."""
    if user.get("role") not in ("expedicao", "master", "departamento"):
        raise HTTPException(403, "Só a expedição registra entrega.")
    if not data.pacote_ids:
        return {"ok": True, "atualizados": 0}

    from datetime import datetime, timezone
    if data.desfazer:
        payload = {"entregue_em": None, "entregue_por_nome": None, "recebido_por": None}
    else:
        payload = {
            "entregue_em": datetime.now(timezone.utc).isoformat(),
            "entregue_por_nome": user.get("full_name") or user.get("email") or "Expedição",
            "recebido_por": ((data.recebido_por or "").strip() or None),
        }

    try:
        # supabase-py devolve as linhas atualizadas por padrao (return=representation)
        r = db.table("emissoes_pacotes").update(payload).in_("id", data.pacote_ids).execute()
        atualizados = len(r.data or [])
    except Exception as e:
        msg = str(e)
        if "entregue_em" in msg and ("PGRST204" in msg or "schema cache" in msg):
            raise HTTPException(400, "Falta rodar a migration 0111 — sem ela não há onde guardar a entrega.")
        raise HTTPException(400, f"Não consegui registrar a entrega: {msg}")

    if data.desfazer:
        return {"ok": True, "atualizados": atualizados, "notificados": 0}

    # Quem avisar: o gerente de cada condomínio entregue.
    pacs = (db.table("emissoes_pacotes")
            .select("id, condominio_id, mes_referencia, ano_referencia")
            .in_("id", data.pacote_ids).execute().data or [])
    condos = {}
    ids = list({p["condominio_id"] for p in pacs if p.get("condominio_id")})
    if ids:
        for c in (db.table("condominios").select("id, name, gerente_id")
                  .in_("id", ids).execute().data or []):
            condos[c["id"]] = c

    notificados = _notificar_entrega(
        db, pacs, condos,
        user.get("full_name") or "A expedição",
        data.recebido_por,
    )
    return {"ok": True, "atualizados": atualizados, "notificados": notificados}


@router.post("/expedicao/avisar")
def api_avisar_expedicao(data: AvisarExpedicaoSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Chamado pela tela logo depois de expedir.

    Separado do ato de expedir de propósito: o aviso pode falhar (SMTP fora,
    ninguém com o papel cadastrado) sem que a expedição deixe de acontecer."""
    if user.get("role") not in ("master", "departamento"):
        raise HTTPException(403, "Apenas master/emissor avisa a expedição.")
    if not data.pacote_ids:
        return {"ok": True, "notificados": 0}
    r = _notificar_expedicao(db, data.pacote_ids, user.get("full_name") or "A emissão")
    return {"ok": True, **r}


@router.post("/edicoes-mensais/{edicao_id}/responder-reabertura")
def api_responder_reabertura(edicao_id: str, data: ResponderReaberturaSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    role = user.get("role")
    if role not in ("master", "departamento"):
        raise HTTPException(403, "Apenas master/emissor pode responder reaberturas")

    edi_res = db.table("edicoes_mensais").select("*").eq("id", edicao_id).limit(1).execute()
    if not edi_res.data:
        raise HTTPException(404, "Edicao nao encontrada")
    edi = edi_res.data[0]

    if edi["status"] != "reabertura_solicitada":
        raise HTTPException(400, "Nao ha solicitacao pendente")

    from datetime import datetime, timezone
    new_status = "em_edicao" if data.aprovar else "edicao_finalizada"
    db.table("edicoes_mensais").update({
        "status": new_status,
        "reabertura_respondida_em": datetime.now(timezone.utc).isoformat(),
        "reabertura_respondida_por": user["id"],
        "reabertura_aprovada": data.aprovar,
    }).eq("id", edicao_id).execute()
    return {"ok": True, "novo_status": new_status}


# ============================================================
# CONSUMOS - faturas de concessionaria por mes/condo
# ============================================================

class ConsumoCreateSchema(BaseModel):
    condominio_id: str
    mes_referencia: int
    ano_referencia: int
    concessionaria: str
    leitura_atual: Optional[str] = None   # YYYY-MM-DD
    proxima_leitura: Optional[str] = None
    vencimento: Optional[str] = None
    valor: Optional[float] = None
    arquivo_url: Optional[str] = None
    arquivo_nome: Optional[str] = None
    arquivo_hash: Optional[str] = None
    descricao: Optional[str] = None
    marcada_repetida: Optional[bool] = False


def _is_assistente_or_emissor_or_master(role: Optional[str]) -> bool:
    return role in ("master", "departamento", "assistente")


@router.get("/consumos")
def api_listar_consumos(
    condominio_id: Optional[str] = None,
    ano: Optional[int] = None,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db),
):
    """Lista faturas. Todos os roles autenticados podem ler."""
    q = db.table("consumos_faturas").select("*, condominios(name)").order("ano_referencia", desc=True).order("mes_referencia", desc=True)
    # Gerente/assistente só enxergam faturas da sua carteira
    if user.get("role") in ("gerente", "assistente"):
        ids = carteira_condo_ids(db, user)
        if not ids:
            return {"consumos": []}
        q = q.in_("condominio_id", ids)
    if condominio_id:
        q = q.eq("condominio_id", condominio_id)
    if ano:
        q = q.eq("ano_referencia", ano)
    res = q.execute()
    return {"consumos": res.data or []}


@router.get("/consumos/condominios-com-faturas")
def api_consumos_condos(user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Lista condos que tem fatura OU estao cadastrados em condominios_concessionarias."""
    import re as _re
    import traceback
    try:
        cfg_map = {}
        # 2 consultas independentes EM PARALELO; merge no cfg_map depois (seguro).
        from concurrent.futures import ThreadPoolExecutor
        def _q_cfg():
            try:
                return db.table("condominios_concessionarias").select("condominio_id, concessionaria").execute().data or []
            except Exception as e:
                print(f"[consumos] cond_conc erro: {e}")
                return []
        def _q_fat():
            try:
                return db.table("consumos_faturas").select("condominio_id, concessionaria").execute().data or []
            except Exception as e:
                print(f"[consumos] consumos_faturas erro: {e}")
                return []
        with ThreadPoolExecutor(max_workers=2) as _ex:
            _fcfg, _ffat = _ex.submit(_q_cfg), _ex.submit(_q_fat)
            _cfg_rows, _fat_rows = _fcfg.result(), _ffat.result()
        for r in _cfg_rows:
            cid = r["condominio_id"]
            cfg_map.setdefault(cid, set()).add(r["concessionaria"])
        for r in _fat_rows:
            cid = r.get("condominio_id")
            if cid:
                cfg_map.setdefault(cid, set()).add(r["concessionaria"])

        if not cfg_map:
            return {"condominios": []}

        ids = list(cfg_map.keys())
        # Chunking para evitar erro com listas grandes
        condos_data = []
        for i in range(0, len(ids), 100):
            chunk = ids[i:i+100]
            res = db.table("condominios").select("id, name, due_day, due_day_2, gerente_id").in_("id", chunk).execute()
            condos_data.extend(res.data or [])

        gerente_ids = list({c.get("gerente_id") for c in condos_data if c.get("gerente_id")})
        gerentes_map = {}
        if gerente_ids:
            for i in range(0, len(gerente_ids), 100):
                chunk = gerente_ids[i:i+100]
                ger_res = db.table("gerentes").select("id, nome").in_("id", chunk).execute()
                for g in (ger_res.data or []):
                    gerentes_map[g["id"]] = g.get("nome")

        out = []
        for c in condos_data:
            nome = c.get("name") or ""
            m = _re.match(r"^(\d+)", nome.strip())
            codigo = int(m.group(1)) if m else 999999
            out.append({
                "id": c["id"],
                "name": nome,
                "codigo": codigo,
                "due_day": c.get("due_day"),
                "due_day_2": c.get("due_day_2"),
                "gerente_id": c.get("gerente_id"),
                "gerente_nome": gerentes_map.get(c.get("gerente_id")),
                "concessionarias": sorted(list(cfg_map.get(c["id"], set()))),
            })
        # Gerente/assistente só enxergam a carteira (própria ou do gerente vinculado)
        if user.get("role") in ("gerente", "assistente"):
            allowed = set(carteira_condo_ids(db, user))
            out = [c for c in out if c["id"] in allowed]
        out.sort(key=lambda x: (x["codigo"], x["name"]))
        return {"condominios": out}
    except Exception as e:
        tb = traceback.format_exc()
        print("[consumos] erro fatal:", tb)
        # Expor o erro para debug remoto
        raise HTTPException(500, f"{type(e).__name__}: {str(e)}")


@router.get("/consumos/check-duplicata")
def api_consumos_check_duplicata(arquivo_hash: str, condominio_id: Optional[str] = None, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Procura faturas existentes com o mesmo hash."""
    q = db.table("consumos_faturas").select("id, condominio_id, condominios(name), mes_referencia, ano_referencia, concessionaria").eq("arquivo_hash", arquivo_hash)
    if condominio_id:
        q = q.eq("condominio_id", condominio_id)
    res = q.execute()
    return {"duplicatas": res.data or []}


class CheckDuplicataCompletaFatura(BaseModel):
    tipo: str = "fatura"  # 'fatura' ou 'relatorio'
    condominio_id: str
    mes_referencia: int
    ano_referencia: int
    # Para fatura
    concessionaria: Optional[str] = None
    leitura_atual: Optional[str] = None        # YYYY-MM-DD
    proxima_leitura: Optional[str] = None
    vencimento: Optional[str] = None
    valor: Optional[float] = None
    # Para relatorio
    empresa: Optional[str] = None
    tipo_servico: Optional[str] = None
    consumo_total: Optional[float] = None
    numero_unidades: Optional[int] = None
    valor_total: Optional[float] = None
    # Hash do PDF (opcional, pode ser checado separado tambem)
    arquivo_hash: Optional[str] = None


# ========== Validação de pertencimento (a conta é deste condomínio?) ==========
import re
import unicodedata as _unicodedata

# Palavras genéricas que não identificam o condomínio (removidas na comparação)
_PALAVRAS_GENERICAS = {
    "CONDOMINIO", "CONDOMINIOS", "COND", "CD",
    "EDIFICIO", "EDIF", "ED", "EDIFICIOS",
    "RESIDENCIAL", "RESID", "RES",
    "COMERCIAL", "EMPRESARIAL",
    "PREDIO", "BLOCO", "TORRE", "TORRES", "CONJUNTO", "CONJ", "CJ",
    "AUTONOMO", "AUTONOMA", "ASSOCIACAO", "ASSOC",
    "DO", "DA", "DE", "DOS", "DAS", "E",
}


def _tokens_significativos(nome: Optional[str]) -> set:
    """Normaliza um nome (sem acento, maiúsculo, sem código numérico/genéricos) -> set de tokens."""
    if not nome:
        return set()
    s = _unicodedata.normalize("NFKD", str(nome)).encode("ascii", "ignore").decode("ascii").upper()
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    toks = set()
    for t in s.split():
        if not t or t.isdigit():           # ignora códigos numéricos ("002")
            continue
        if t in _PALAVRAS_GENERICAS:
            continue
        if len(t) < 3:                      # ignora siglas curtas/ruído
            continue
        toks.add(t)
    return toks


def _score_pertencimento(cliente: Optional[str], condo_nome: Optional[str]) -> float:
    """0.0 a 1.0 — quão bem o nome do cliente (na conta) casa com o nome do condomínio."""
    a = _tokens_significativos(cliente)
    b = _tokens_significativos(condo_nome)
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def checar_pertencimento(db: Client, condominio_id: str, cliente: Optional[str]) -> Optional[dict]:
    """
    Retorna um alerta de BLOQUEIO se a conta claramente NÃO pertence ao condomínio
    selecionado (o nome do cliente casa muito melhor com outro condomínio cadastrado).
    Retorna None quando passa (ou quando não há dados suficientes para decidir).
    """
    if not cliente or len(_tokens_significativos(cliente)) < 2:
        return None  # sem nome confiável na conta -> não dá pra validar

    try:
        sel = db.table("condominios").select("id, name").eq("id", condominio_id).maybe_single().execute()
        condo_sel = sel.data or {}
    except Exception:
        return None
    nome_sel = condo_sel.get("name")
    score_sel = _score_pertencimento(cliente, nome_sel)
    if score_sel >= 0.34:
        return None  # casa com o condomínio selecionado -> ok

    # Não casou com o selecionado. Procura se casa com OUTRO condomínio.
    try:
        todos = db.table("condominios").select("id, name").execute().data or []
    except Exception:
        todos = []

    melhor = None
    melhor_score = 0.0
    for c in todos:
        if c.get("id") == condominio_id:
            continue
        sc = _score_pertencimento(cliente, c.get("name"))
        if sc > melhor_score:
            melhor_score = sc
            melhor = c

    # Só bloqueia quando há outro condomínio que casa claramente melhor.
    if melhor and melhor_score >= 0.5 and melhor_score > score_sel:
        return {
            "nivel": "bloqueio",
            "tipo": "pertencimento",
            "mensagem": (
                f"Esta conta é do cliente \"{cliente}\", que corresponde ao condomínio "
                f"\"{melhor.get('name')}\" — NÃO a \"{nome_sel or 'este condomínio'}\". "
                f"Retire esta conta: não é permitido anexar fatura de outro condomínio."
            ),
            "detalhes": {
                "cliente": cliente,
                "condominio_selecionado": nome_sel,
                "condominio_correto": melhor.get("name"),
            },
        }
    return None


@router.post("/consumos/check-duplicata-completa")
def api_check_duplicata_completa(data: CheckDuplicataCompletaFatura, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """
    Verifica em 3 niveis:
      1. Hash identico (qualquer condo)
      2. (condo, mes, ano, conc OR empresa+tipo) ja existe
      3. Dados iguais ao mes anterior (leituras+valor pra fatura; consumo+valor+unidades pra relatorio)
    Retorna { bloqueia: bool, alertas: [...], anomalia: {...} }
    """
    alertas = []  # cada alerta: { nivel: 'bloqueio'|'aviso', tipo, mensagem, detalhes }

    # ===== 1) Hash duplicado =====
    if data.arquivo_hash:
        if data.tipo == "fatura":
            res = db.table("consumos_faturas").select(
                "id, condominio_id, condominios(name), mes_referencia, ano_referencia, concessionaria"
            ).eq("arquivo_hash", data.arquivo_hash).execute()
        else:
            res = db.table("consumos_relatorios_leitura").select(
                "id, condominio_id, condominios(name), mes_referencia, ano_referencia, empresa_leitura, tipo_servico"
            ).eq("arquivo_hash", data.arquivo_hash).execute()

        for hit in (res.data or []):
            alertas.append({
                "nivel": "bloqueio",
                "tipo": "hash_identico",
                "mensagem": "Este arquivo PDF identico ja foi anexado anteriormente.",
                "detalhes": hit,
            })

    # ===== 2) Mesma fatura/relatorio para o mesmo periodo (UNIQUE) =====
    if data.tipo == "fatura" and data.concessionaria:
        res = db.table("consumos_faturas").select(
            "id, valor, vencimento, leitura_atual, proxima_leitura, arquivo_url, arquivo_nome"
        ).eq("condominio_id", data.condominio_id) \
         .eq("ano_referencia", data.ano_referencia) \
         .eq("mes_referencia", data.mes_referencia) \
         .eq("concessionaria", data.concessionaria.upper()) \
         .execute()
        if res.data:
            alertas.append({
                "nivel": "aviso",
                "tipo": "fatura_ja_existe",
                "mensagem": f"Ja existe {len(res.data)} fatura(s) de {data.concessionaria} em {data.mes_referencia:02d}/{data.ano_referencia}. Se for outra instalacao/conta, pode anexar normalmente.",
                "detalhes": res.data[0],
            })
    elif data.tipo == "relatorio" and data.empresa and data.tipo_servico:
        res = db.table("consumos_relatorios_leitura").select(
            "id, valor_total, consumo_total, numero_unidades, data_leitura, arquivo_url, arquivo_nome"
        ).eq("condominio_id", data.condominio_id) \
         .eq("ano_referencia", data.ano_referencia) \
         .eq("mes_referencia", data.mes_referencia) \
         .eq("empresa_leitura", data.empresa.upper()) \
         .eq("tipo_servico", data.tipo_servico.lower()) \
         .execute()
        if res.data:
            alertas.append({
                "nivel": "aviso",
                "tipo": "relatorio_ja_existe",
                "mensagem": f"Ja existe {len(res.data)} relatorio(s) de {data.empresa} ({data.tipo_servico}) em {data.mes_referencia:02d}/{data.ano_referencia}. Se for outra leitura/conta, pode anexar normalmente.",
                "detalhes": res.data[0],
            })

    # ===== 3) Dados iguais ao mes anterior =====
    # Calcula mes anterior
    mes_ant = data.mes_referencia - 1
    ano_ant = data.ano_referencia
    if mes_ant == 0:
        mes_ant = 12
        ano_ant -= 1

    anomalia = None

    if data.tipo == "fatura" and data.concessionaria:
        res = db.table("consumos_faturas").select(
            "id, valor, vencimento, leitura_atual, proxima_leitura, arquivo_nome"
        ).eq("condominio_id", data.condominio_id) \
         .eq("ano_referencia", ano_ant) \
         .eq("mes_referencia", mes_ant) \
         .eq("concessionaria", data.concessionaria.upper()) \
         .maybe_single().execute()
        prev = res.data
        if prev:
            iguais = 0
            campos = []
            if data.leitura_atual and prev.get("leitura_atual") and str(data.leitura_atual) == str(prev["leitura_atual"]):
                iguais += 1; campos.append("leitura_atual")
            if data.proxima_leitura and prev.get("proxima_leitura") and str(data.proxima_leitura) == str(prev["proxima_leitura"]):
                iguais += 1; campos.append("proxima_leitura")
            if data.valor is not None and prev.get("valor") is not None and abs(float(data.valor) - float(prev["valor"])) < 0.01:
                iguais += 1; campos.append("valor")
            # Variacao percentual de valor
            variacao_pct = None
            try:
                if data.valor is not None and prev.get("valor"):
                    prev_v = float(prev["valor"])
                    if prev_v > 0:
                        variacao_pct = (float(data.valor) - prev_v) / prev_v * 100.0
            except Exception:
                pass
            anomalia = {
                "previous": prev,
                "campos_iguais": campos,
                "total_iguais": iguais,
                "variacao_pct": variacao_pct,
            }
            if iguais >= 3:
                alertas.append({
                    "nivel": "bloqueio",
                    "tipo": "dados_iguais_mes_anterior",
                    "mensagem": "Leitura atual, proxima leitura e valor sao identicos ao mes anterior. Provavelmente a mesma fatura foi anexada novamente.",
                    "detalhes": prev,
                    "campos_iguais": campos,
                })
            elif iguais == 2:
                alertas.append({
                    "nivel": "aviso",
                    "tipo": "dados_parcialmente_iguais",
                    "mensagem": f"2 dos 3 campos ({', '.join(campos)}) sao identicos ao mes anterior. Confira se nao e um reenvio.",
                    "detalhes": prev,
                    "campos_iguais": campos,
                })

    elif data.tipo == "relatorio" and data.empresa and data.tipo_servico:
        res = db.table("consumos_relatorios_leitura").select(
            "id, consumo_total, valor_total, numero_unidades, data_leitura, arquivo_nome"
        ).eq("condominio_id", data.condominio_id) \
         .eq("ano_referencia", ano_ant) \
         .eq("mes_referencia", mes_ant) \
         .eq("empresa_leitura", data.empresa.upper()) \
         .eq("tipo_servico", data.tipo_servico.lower()) \
         .maybe_single().execute()
        prev = res.data
        if prev:
            iguais = 0
            campos = []
            if data.consumo_total is not None and prev.get("consumo_total") is not None and abs(float(data.consumo_total) - float(prev["consumo_total"])) < 0.01:
                iguais += 1; campos.append("consumo_total")
            if data.valor_total is not None and prev.get("valor_total") is not None and abs(float(data.valor_total) - float(prev["valor_total"])) < 0.01:
                iguais += 1; campos.append("valor_total")
            if data.numero_unidades is not None and prev.get("numero_unidades") is not None and int(data.numero_unidades) == int(prev["numero_unidades"]):
                iguais += 1; campos.append("numero_unidades")
            variacao_pct = None
            try:
                if data.valor_total is not None and prev.get("valor_total"):
                    prev_v = float(prev["valor_total"])
                    if prev_v > 0:
                        variacao_pct = (float(data.valor_total) - prev_v) / prev_v * 100.0
            except Exception:
                pass
            anomalia = {
                "previous": prev,
                "campos_iguais": campos,
                "total_iguais": iguais,
                "variacao_pct": variacao_pct,
            }
            if iguais >= 3 or (iguais >= 2 and "valor_total" in campos and "consumo_total" in campos):
                alertas.append({
                    "nivel": "bloqueio",
                    "tipo": "dados_iguais_mes_anterior",
                    "mensagem": "Consumo total e valor sao identicos ao mes anterior. Provavelmente o mesmo relatorio foi reenviado.",
                    "detalhes": prev,
                    "campos_iguais": campos,
                })
            elif iguais >= 1 and variacao_pct is not None and abs(variacao_pct) < 5:
                alertas.append({
                    "nivel": "aviso",
                    "tipo": "variacao_minima",
                    "mensagem": f"Valor com variacao < 5% em relacao ao mes anterior ({variacao_pct:.1f}%). Confira se nao e o mesmo relatorio.",
                    "detalhes": prev,
                })

    bloqueia = any(a["nivel"] == "bloqueio" for a in alertas)
    return {
        "bloqueia": bloqueia,
        "alertas": alertas,
        "anomalia": anomalia,
    }


class ConfirmarRepeticaoSchema(BaseModel):
    tipo: str  # 'fatura' ou 'relatorio'
    condominio_id: str
    mes_referencia: int
    ano_referencia: int
    motivo: str
    anexo_url: Optional[str] = None      # documento de aprovação da repetição (obrigatório)
    anexo_nome: Optional[str] = None
    # Identificação do registro recém-criado pelo trigger
    concessionaria: Optional[str] = None  # fatura
    empresa: Optional[str] = None         # relatorio
    tipo_servico: Optional[str] = None    # relatorio


@router.post("/consumos/sancionar-repeticao")
def api_sancionar_repeticao(data: ConfirmarRepeticaoSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """
    Sanciona a repetição de uma conta. Exige MOTIVO e ANEXO de aprovação.
    O emissor (assistente/departamento/master) pode sancionar a própria repetição.
    """
    if not _is_assistente_or_emissor_or_master(user.get("role")):
        raise HTTPException(403, "Sem permissao para sancionar repeticao")
    if not data.motivo or not data.motivo.strip():
        raise HTTPException(400, "Motivo e obrigatorio")
    if not data.anexo_url:
        raise HTTPException(400, "Anexo de aprovacao da repeticao e obrigatorio")
    from datetime import datetime, timezone
    payload = {
        "marcada_repetida": True,
        "motivo_repeticao": data.motivo.strip(),
        "repeticao_anexo_url": data.anexo_url,
        "repeticao_anexo_nome": data.anexo_nome,
        "repeticao_confirmada_por": user["id"],
        "repeticao_confirmada_em": datetime.now(timezone.utc).isoformat(),
    }
    table = "consumos_faturas" if data.tipo == "fatura" else "consumos_relatorios_leitura"
    q = db.table(table).update(payload) \
        .eq("condominio_id", data.condominio_id) \
        .eq("ano_referencia", data.ano_referencia) \
        .eq("mes_referencia", data.mes_referencia)
    if data.tipo == "fatura":
        if data.concessionaria:
            q = q.eq("concessionaria", data.concessionaria.upper())
    else:
        if data.empresa:
            q = q.eq("empresa_leitura", data.empresa.upper())
        if data.tipo_servico:
            q = q.eq("tipo_servico", data.tipo_servico.lower())
    q.execute()
    return {"ok": True}


@router.post("/consumos/extrair-pdf")
async def api_extrair_pdf(
    file: UploadFile = File(...),
    condominio_id: Optional[str] = None,
    mes_referencia: Optional[int] = None,
    ano_referencia: Optional[int] = None,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db),
):
    """
    Extrai dados de um PDF de fatura (SABESP/COMGAS/ENEL) ou relatorio (Prosper).
    Se condominio_id+mes+ano forem passados, tambem roda o check de duplicata.
    Retorna: { extracao: {...}, alertas: [...], anomalia: {...}, bloqueia: bool }
    """
    import hashlib
    from pdf_extractor import extract_pdf, cnpj_to_passwords

    contents = await file.read()
    arquivo_hash = hashlib.sha256(contents).hexdigest()

    # Senhas-candidatas para PDFs protegidos (derivadas do CNPJ do condominio)
    passwords = []
    if condominio_id:
        try:
            cres = db.table("condominios").select("cnpj").eq("id", condominio_id).maybe_single().execute()
            passwords = cnpj_to_passwords((cres.data or {}).get("cnpj"))
        except Exception as e:
            print(f"[extrair-pdf] falha ao buscar cnpj do condo: {e}")

    extracao = extract_pdf(contents, passwords=passwords)
    extracao['arquivo_hash'] = arquivo_hash
    extracao['arquivo_nome'] = file.filename

    # Status derivado pra UI/persistencia
    conf = extracao.get('confianca') or 0.0
    if extracao.get('erro'):
        extracao['status'] = 'falha'
    elif conf >= 0.8:
        extracao['status'] = 'sucesso'
    else:
        extracao['status'] = 'parcial'

    alertas = []
    anomalia = None
    bloqueia = False

    # ===== Pertencimento: a conta é DESTE condomínio? (bloqueio duro, prioridade máxima) =====
    if condominio_id and not extracao.get('erro'):
        try:
            alerta_pert = checar_pertencimento(db, condominio_id, extracao.get('cliente'))
            if alerta_pert:
                alertas.append(alerta_pert)
                bloqueia = True
        except Exception as e:
            print(f"[extrair-pdf] check pertencimento falhou: {e}")

    # Se identificou a empresa e tem contexto, valida duplicata
    if extracao.get('subtipo') and condominio_id and mes_referencia and ano_referencia:
        check_body = CheckDuplicataCompletaFatura(
            tipo='relatorio' if extracao.get('tipo') == 'relatorio' else 'fatura',
            condominio_id=condominio_id,
            mes_referencia=mes_referencia,
            ano_referencia=ano_referencia,
            arquivo_hash=arquivo_hash,
        )
        if extracao.get('tipo') == 'fatura':
            check_body.concessionaria = extracao['subtipo'].upper()
            check_body.leitura_atual = extracao.get('leitura_atual')
            check_body.proxima_leitura = extracao.get('proxima_leitura')
            check_body.vencimento = extracao.get('vencimento')
            check_body.valor = extracao.get('valor')
        else:
            check_body.empresa = extracao['subtipo'].upper()
            check_body.tipo_servico = extracao.get('tipo_servico', 'agua')
            check_body.consumo_total = extracao.get('consumo_total')
            check_body.valor_total = extracao.get('valor_total')
            check_body.numero_unidades = extracao.get('numero_unidades')

        try:
            result = api_check_duplicata_completa(check_body, user, db)
            # Mantém o alerta de pertencimento já adicionado (não sobrescreve)
            alertas = alertas + (result.get('alertas') or [])
            anomalia = result.get('anomalia')
            bloqueia = bloqueia or result.get('bloqueia', False)
        except Exception as e:
            print(f"[extrair-pdf] check duplicata falhou: {e}")

    return {
        'extracao': extracao,
        'alertas': alertas,
        'anomalia': anomalia,
        'bloqueia': bloqueia,
    }


@router.post("/consumos")
def api_criar_consumo(data: ConsumoCreateSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Cria fatura. Assistente cria como 'pendente'. Master/Emissor podem criar ja 'anexada'."""
    role = user.get("role")
    if not _is_assistente_or_emissor_or_master(role):
        raise HTTPException(403, "Sem permissao para criar faturas de consumo")

    payload = data.dict(exclude_unset=True)
    payload["enviada_por"] = user["id"]
    payload["status"] = "pendente"
    try:
        res = db.table("consumos_faturas").insert(payload).execute()
        if not res.data:
            raise HTTPException(500, "Falha ao criar fatura")
        return {"ok": True, "consumo": res.data[0]}
    except Exception as e:
        msg = str(e)
        if "uq_consumos_condo_periodo_conc" in msg or "duplicate key" in msg.lower():
            raise HTTPException(400, "Este arquivo identico ja foi anexado para esta concessionaria neste mes. (Contas de instalacoes diferentes sao permitidas — verifique se nao e o mesmo PDF.)")
        raise HTTPException(400, msg)


class ConsumoUpdateSchema(BaseModel):
    leitura_atual: Optional[str] = None
    proxima_leitura: Optional[str] = None
    vencimento: Optional[str] = None
    valor: Optional[float] = None
    arquivo_url: Optional[str] = None
    arquivo_nome: Optional[str] = None
    arquivo_hash: Optional[str] = None
    descricao: Optional[str] = None
    marcada_repetida: Optional[bool] = None
    concessionaria: Optional[str] = None


@router.patch("/consumos/{consumo_id}")
def api_atualizar_consumo(consumo_id: str, data: ConsumoUpdateSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    role = user.get("role")
    if not _is_assistente_or_emissor_or_master(role):
        raise HTTPException(403, "Sem permissao")
    payload = data.dict(exclude_unset=True)
    if not payload:
        return {"ok": True}
    db.table("consumos_faturas").update(payload).eq("id", consumo_id).execute()
    return {"ok": True}


@router.post("/consumos/{consumo_id}/anexar")
def api_anexar_consumo(consumo_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Emissor/Master marca como 'anexada' (final)."""
    role = user.get("role")
    if role not in ("master", "departamento"):
        raise HTTPException(403, "Apenas emissor/master pode anexar")
    from datetime import datetime, timezone
    db.table("consumos_faturas").update({
        "status": "anexada",
        "anexada_por": user["id"],
        "anexada_em": datetime.now(timezone.utc).isoformat(),
    }).eq("id", consumo_id).execute()
    return {"ok": True}


@router.post("/consumos/{consumo_id}/duplicar")
def api_duplicar_consumo(consumo_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Duplica a fatura para o proximo mes: datas + 1 mes, valor/arquivo zerados."""
    role = user.get("role")
    if not _is_assistente_or_emissor_or_master(role):
        raise HTTPException(403, "Sem permissao")

    orig = db.table("consumos_faturas").select("*").eq("id", consumo_id).maybe_single().execute()
    if not orig.data:
        raise HTTPException(404, "Fatura nao encontrada")
    o = orig.data

    from datetime import datetime, date
    def _add_month_iso(s):
        if not s:
            return None
        try:
            d = datetime.strptime(s, "%Y-%m-%d").date()
        except Exception:
            return None
        m = d.month + 1
        y = d.year
        if m > 12:
            m = 1
            y += 1
        try:
            return date(y, m, d.day).isoformat()
        except ValueError:
            # Caso o dia nao exista no proximo mes (ex: 31/01 -> 28/02)
            import calendar
            last = calendar.monthrange(y, m)[1]
            return date(y, m, min(d.day, last)).isoformat()

    next_mes = o["mes_referencia"] + 1
    next_ano = o["ano_referencia"]
    if next_mes > 12:
        next_mes = 1
        next_ano += 1

    new_row = {
        "condominio_id": o["condominio_id"],
        "mes_referencia": next_mes,
        "ano_referencia": next_ano,
        "concessionaria": o["concessionaria"],
        "leitura_atual": _add_month_iso(o.get("leitura_atual")),
        "proxima_leitura": _add_month_iso(o.get("proxima_leitura")),
        "vencimento": _add_month_iso(o.get("vencimento")),
        "valor": None,
        "arquivo_url": None,
        "arquivo_nome": None,
        "arquivo_hash": None,
        "descricao": None,
        "marcada_repetida": False,
        "status": "pendente",
        "enviada_por": user["id"],
        "origem_duplicacao": o["id"],
    }
    try:
        res = db.table("consumos_faturas").insert(new_row).execute()
        return {"ok": True, "consumo": (res.data or [None])[0]}
    except Exception as e:
        msg = str(e)
        if "uq_consumos_condo_periodo_conc" in msg or "duplicate key" in msg.lower():
            raise HTTPException(400, f"Ja existe fatura de {o['concessionaria']} em {next_mes:02d}/{next_ano}")
        raise HTTPException(400, msg)


@router.delete("/consumos/{consumo_id}")
def api_deletar_consumo(consumo_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    role = user.get("role")
    if role not in ("master", "departamento"):
        raise HTTPException(403, "Apenas master/emissor pode deletar")

    arquivo_url = None
    origem_id = None
    tabela = None

    # Detecta se o id é de uma FATURA ou de um RELATÓRIO de leitura
    try:
        c = db.table("consumos_faturas").select(
            "arquivo_url, origem_emissao_arquivo_id"
        ).eq("id", consumo_id).maybe_single().execute()
        if c.data:
            tabela = "consumos_faturas"
            arquivo_url = c.data.get("arquivo_url")
            origem_id = c.data.get("origem_emissao_arquivo_id")
    except Exception:
        pass

    if not tabela:
        try:
            r = db.table("consumos_relatorios_leitura").select(
                "arquivo_url, origem_emissao_arquivo_id"
            ).eq("id", consumo_id).maybe_single().execute()
            if r.data:
                tabela = "consumos_relatorios_leitura"
                arquivo_url = r.data.get("arquivo_url")
                origem_id = r.data.get("origem_emissao_arquivo_id")
        except Exception:
            pass

    if not tabela:
        raise HTTPException(404, "Consumo não encontrado (fatura ou relatório)")

    # 1) Remove a fatura/relatório
    db.table(tabela).delete().eq("id", consumo_id).execute()

    # 2) Remove o anexo de origem na Central (o trigger AFTER DELETE limpa o resto)
    if origem_id:
        try:
            db.table("emissoes_arquivos").delete().eq("id", origem_id).execute()
        except Exception:
            pass

    # 3) Remove o PDF do storage
    if arquivo_url:
        try:
            db.storage.from_("emissoes").remove([arquivo_url])
        except Exception:
            pass

    return {"ok": True}
