# ═══════════════════════════════════════════════════════════════════════
# CondoFlow — Novas rotas RBAC + Conferência
# Cole este bloco no FINAL do arquivo api/api_routes.py
# ═══════════════════════════════════════════════════════════════════════

from datetime import datetime
import hashlib

MESES_PT = {
    1: 'Jan', 2: 'Fev', 3: 'Mar', 4: 'Abr', 5: 'Mai', 6: 'Jun',
    7: 'Jul', 8: 'Ago', 9: 'Set', 10: 'Out', 11: 'Nov', 12: 'Dez'
}

# ═══ RBAC helpers ═════════════════════════════════════════════════════

ROLES_APROVADORES = ['master', 'gerente', 'supervisora', 'supervisora_contabilidade']
ROLES_EMISSORES = ['master', 'emissor']
ROLES_LANCA_COBRANCAS = ['master', 'gerente', 'assistente']


def require_role(user: dict, roles: list):
    """Levanta 403 se o usuário não tiver um dos roles permitidos."""
    if user.get('role') not in roles:
        raise HTTPException(403, f"Acesso negado. Requer role: {', '.join(roles)}")


# ═══ Endpoint: Dados de conferência (Planilha + Cobranças) ════════════

@router.get("/condominio/{condo_id}/conferencia")
def api_dados_conferencia(condo_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """
    Retorna dados de apoio para conferir um documento:
    - Planilha anual (arrecadações mês a mês)
    - Cobranças extras lançadas para o condomínio

    Todos os roles autenticados podem ler (é modo leitura).
    """
    try:
        # 1) Arrecadações mês a mês (ano corrente)
        year = datetime.now().year
        arrec_res = db.table("arrecadacoes") \
            .select("mes, condominio_valor, fundo_reserva, total") \
            .eq("condominio_id", condo_id) \
            .eq("ano", year) \
            .order("mes") \
            .execute()

        meses = []
        total_condo = 0
        total_fundo = 0
        total_geral = 0
        for r in (arrec_res.data or []):
            condo_v = float(r.get('condominio_valor') or 0)
            fundo_v = float(r.get('fundo_reserva') or 0)
            tot_v = float(r.get('total') or (condo_v + fundo_v))
            meses.append({
                'mes': r.get('mes'),
                'mes_nome': MESES_PT.get(r.get('mes'), str(r.get('mes'))),
                'condominio': condo_v,
                'fundo_reserva': fundo_v,
                'total': tot_v,
            })
            total_condo += condo_v
            total_fundo += fundo_v
            total_geral += tot_v

        # 2) Cobranças extras (do ano corrente)
        extras_res = db.table("cobrancas_extras") \
            .select("id, descricao, mes, valor, ano") \
            .eq("condominio_id", condo_id) \
            .eq("ano", year) \
            .order("mes") \
            .execute()

        cobrancas = []
        for c in (extras_res.data or []):
            cobrancas.append({
                'id': c.get('id'),
                'descricao': c.get('descricao'),
                'mes': c.get('mes'),
                'mes_nome': MESES_PT.get(c.get('mes'), str(c.get('mes'))),
                'valor': float(c.get('valor') or 0),
            })

        return {
            'planilha': {
                'ano': year,
                'meses': meses,
                'totais': {
                    'condominio': total_condo,
                    'fundo_reserva': total_fundo,
                    'total': total_geral,
                }
            },
            'cobrancas_extras': cobrancas,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Erro ao carregar conferência: {str(e)}")


# ═══ Endpoint: Aprovar / Solicitar correção + Assinatura ══════════════

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
            if current_status == 'Enviado':
                update_payload['status'] = 'Em aprovação'
            elif current_status == 'Em aprovação':
                update_payload['status'] = 'Aprovado'
            else:
                update_payload['status'] = 'Aprovado'
            historico_action = 'Aprovado'

            # Assinatura digital
            if data.sign:
                content_hash = hashlib.sha256(
                    f"{processo_id}:{user['id']}:{datetime.utcnow().isoformat()}".encode()
                ).hexdigest()
                db.table("assinaturas").insert({
                    "processo_id": processo_id,
                    "signer_id": user['id'],
                    "signer_name": user.get('full_name') or user.get('email', 'Usuário'),
                    "signer_role": user.get('role'),
                    "signature_hash": content_hash,
                    "metadata": {"action": "approve"}
                }).execute()

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

        if role in ROLES_APROVADORES:
            # Quem aprova vê os aguardando sua ação
            query = query.in_("status", ["Enviado", "Em aprovação"])

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
        elif role in ['emissor', 'assistente']:
            # Emissor/assistente vê os que voltaram pra correção (emitidos por ele)
            query = query.eq("emitido_por", user['id']).eq("status", "Solicitar alteração")
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
        raise HTTPException(400, str(e))
