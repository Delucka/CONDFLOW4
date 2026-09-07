"""Cache de processo para o que não muda a cada clique.

POR QUE ISTO EXISTE
-------------------
Medido em 07/09/2026: o banco fica a **185 ms** daqui (região da costa oeste
dos EUA; São Paulo responde em 4 ms). Cada ida custa esse trajeto inteiro, e
`carteira_condo_ids` fazia TRÊS — ausências, gerentes, condomínios — em cada
uma das 29 chamadas espalhadas pelas rotas. O `/api/dashboard` chamava duas
vezes. Só de preâmbulo, antes de qualquer consulta útil, um gerente pagava
~1,7 s.

O QUE MUDA
----------
Em vez de guardar a RESPOSTA por usuário, guardamos as três TABELAS que a
resposta usa. São minúsculas — 325 condomínios, ~20 gerentes, um punhado de
ausências abertas — e servem todo mundo: a primeira requisição depois do TTL
aquece, e as outras vinte pessoas não vão à rede. A carteira volta a ser
calculada em memória, a cada requisição, sem atalho.

JANELA DE DESATUALIZAÇÃO
------------------------
`TTL = 120 s`, o MESMO que o cache de token já usa em `deps.py` para guardar o
papel do usuário — que é privilégio mais forte que a carteira. Não estamos
abrindo janela nova, estamos reusando a que já foi aceita.

E ela quase não é usada: toda escrita nossa que mexe em carteira chama
`invalidar()` (transferência de condomínio, férias, vínculo de assistente), e
aí a mudança vale no clique seguinte. A janela só existe para mudança feita
por fora — SQL na mão, direto no painel.

REGRA: falhar aqui nunca pode derrubar a requisição. Qualquer erro na leitura
cacheada cai para a consulta direta, que é o comportamento de antes.
"""

import threading
import time
from datetime import date

TTL = 120

_dados: dict = {}                      # chave -> (valor, gravado_em)
_trava = threading.Lock()              # protege _dados
_travas_de_carga: dict = {}            # chave -> Lock, um por chave


def _buscar(chave, carregar, ttl=TTL):
    """Valor cacheado, ou o resultado de `carregar()`.

    Uma trava POR CHAVE, e não uma global: sem isso, vinte requisições
    simultâneas com o cache frio disparariam vinte consultas iguais — e com uma
    trava só, uma consulta lenta de `condominios` seguraria quem só queria
    `gerentes`.
    """
    agora = time.time()
    hit = _dados.get(chave)
    if hit and agora - hit[1] < ttl:
        return hit[0]

    with _trava:
        trava = _travas_de_carga.setdefault(chave, threading.Lock())

    with trava:
        # Outra thread pode ter carregado enquanto esperávamos na trava.
        hit = _dados.get(chave)
        if hit and time.time() - hit[1] < ttl:
            return hit[0]
        valor = carregar()
        _dados[chave] = (valor, time.time())
        return valor


def invalidar(*chaves):
    """Esquece o que foi cacheado. Sem argumento, esquece tudo."""
    with _trava:
        if not chaves:
            _dados.clear()
        else:
            for c in chaves:
                _dados.pop(c, None)


def invalidar_carteiras():
    """Chamada por toda escrita que muda quem responde por qual condomínio."""
    invalidar('condominios', 'gerentes', 'ausencias', 'profiles_gerente')


# ── As três tabelas ───────────────────────────────────────────────────

def condominios(db):
    """`{condominio_id: gerente_id}` — 325 linhas, três colunas.

    `select('*')` nesta tabela são 238 KB e 530 ms; estas três colunas são
    45 KB e 270 ms. Aqui só precisamos de quem é o dono.
    """
    return _buscar('condominios', lambda: {
        c['id']: c.get('gerente_id')
        for c in (db.table("condominios").select("id, gerente_id").execute().data or [])
    })


def gerentes_por_profile(db):
    """`{profile_id: gerentes.id}` — o de-para que `get_gerente_id` fazia por ida."""
    return _buscar('gerentes', lambda: {
        g['profile_id']: g['id']
        for g in (db.table("gerentes").select("id, profile_id").execute().data or [])
        if g.get('profile_id')
    })


def ausencias_de_hoje(db):
    """`{substituto_id: [condominio_id, ...]}` para as coberturas ativas HOJE (0117).

    Cacheado com a DATA na chave: uma cobertura que termina hoje não pode
    sobreviver à virada do dia dentro de um processo que ficou de pé.
    """
    hoje = date.today().isoformat()

    def carregar():
        linhas = (db.table("gerente_ausencia_condominios")
                  .select("condominio_id, substituto_id, "
                          "gerente_ausencias!inner(data_inicio, data_fim, encerrada_em)")
                  .is_("gerente_ausencias.encerrada_em", "null")
                  .lte("gerente_ausencias.data_inicio", hoje)
                  .gte("gerente_ausencias.data_fim", hoje)
                  .execute().data or [])
        por_substituto: dict = {}
        for l in linhas:
            por_substituto.setdefault(l["substituto_id"], []).append(l["condominio_id"])
        return por_substituto

    return _buscar(f'ausencias:{hoje}', carregar)


def gerente_id_do_profile(db, profile_id):
    if not profile_id:
        return None
    return gerentes_por_profile(db).get(profile_id)


def condominios_do_gerente(db, gerente_id):
    if not gerente_id:
        return []
    return [cid for cid, gid in condominios(db).items() if gid == gerente_id]
