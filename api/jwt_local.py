"""Validar o token aqui, em vez de perguntar ao Supabase a cada requisição.

O CUSTO QUE ISTO TIRA
---------------------
`db.auth.get_user(token)` é uma chamada de rede ao Supabase Auth, e acontecia em
TODA requisição da API antes de qualquer coisa útil. Com o banco em us-west-2
(185 ms daqui), é ~200 ms de taxa fixa por clique — inclusive nos que só liam
algo já cacheado.

O token não precisa de ninguém para ser conferido: ele vem assinado. O projeto
publica a chave **pública** em `/auth/v1/.well-known/jwks.json` (ES256, curva
P-256, conferido em 07/09/2026), então dá para verificar a assinatura aqui
mesmo, sem segredo para guardar e sem ida à rede.

O QUE ISTO NÃO FAZ
------------------
Não substitui a revogação. Um token continua válido aqui até expirar sozinho,
mesmo que a sessão tenha sido derrubada do outro lado — que é o preço de não
perguntar. É a mesma janela que o cache de token já praticava (120 s), só que
agora limitada pelo `exp` do próprio token. Se um dia for preciso derrubar
alguém na hora, o caminho é encurtar a vida do token no painel, não voltar a
pagar 200 ms por requisição.

REGRAS DE SEGURANÇA QUE ESTE ARQUIVO SEGUE
------------------------------------------
1. Assinatura sempre verificada. Nunca `verify_signature=False`.
2. O algoritmo sai do cabeçalho do token, mas cada família só pode ser
   verificada com o material CERTO: `ES*`/`RS*` só contra a chave pública do
   JWKS; `HS256` só contra o segredo configurado. Nunca a chave pública como
   segredo de HMAC — é assim que nasce o ataque de confusão de algoritmo.
3. `alg: none` e qualquer algoritmo fora da lista são recusados.
4. `exp`, `aud` (`authenticated`) e `iss` conferidos.
5. **Assinatura inválida é 401, não é motivo para tentar pela rede.** Só caímos
   para `auth.get_user` quando NÃO TEMOS como conferir (JWKS fora do ar,
   algoritmo HS256 sem segredo configurado) — nunca quando a conferência foi
   feita e reprovou.
"""

import json
import os
import threading
import time
import urllib.request

_ASSIMETRICOS = ("ES256", "ES384", "ES512", "RS256", "RS384", "RS512")

_jwks = None            # (chaves_por_kid, buscado_em)
_trava = threading.Lock()
_TTL_JWKS = 3600


class NaoDaParaConferir(Exception):
    """Falta material para conferir — quem chamou que use a rede."""


def _url_base():
    return (os.getenv("SUPABASE_URL", "") or "").rstrip("/")


def _buscar_jwks():
    """`{kid: PyJWK}`. Rede uma vez por hora por processo, não por requisição."""
    global _jwks
    agora = time.time()
    if _jwks and agora - _jwks[1] < _TTL_JWKS:
        return _jwks[0]
    with _trava:
        if _jwks and time.time() - _jwks[1] < _TTL_JWKS:
            return _jwks[0]
        import jwt as _pyjwt
        url = _url_base() + "/auth/v1/.well-known/jwks.json"
        try:
            with urllib.request.urlopen(url, timeout=5) as r:
                dados = json.load(r)
        except Exception as e:
            # JWKS fora do ar, DNS, timeout: não temos como conferir agora.
            # Isso é "cai para a rede", nunca erro 500 na cara do usuário.
            raise NaoDaParaConferir(f"JWKS inacessível ({type(e).__name__})")
        chaves = {}
        for k in dados.get("keys", []):
            if k.get("kid"):
                try:
                    chaves[k["kid"]] = _pyjwt.PyJWK(k)
                except Exception:
                    pass    # chave que esta versão do PyJWT não entende: ignora
        if not chaves:
            raise NaoDaParaConferir("JWKS sem chave utilizável")
        _jwks = (chaves, time.time())
        return chaves


def conferir(token: str) -> dict:
    """As reivindicações do token, com a assinatura verificada.

    Levanta `NaoDaParaConferir` quando falta material (aí o chamador vai à
    rede) e `jwt.InvalidTokenError` quando o token é ruim (aí é 401, ponto).
    """
    import jwt as _pyjwt

    cabecalho = _pyjwt.get_unverified_header(token)   # só o cabeçalho; nada é confiado ainda
    alg = cabecalho.get("alg")

    if alg in _ASSIMETRICOS:
        chaves = _buscar_jwks()
        kid = cabecalho.get("kid")
        chave = chaves.get(kid)
        if chave is None:
            # Chave nova depois de uma rotação: rebusca uma vez.
            global _jwks
            _jwks = None
            chave = _buscar_jwks().get(kid)
        if chave is None:
            raise NaoDaParaConferir(f"kid {kid} não está no JWKS")
        material, algoritmos = chave.key, [alg]

    elif alg == "HS256":
        segredo = os.getenv("SUPABASE_JWT_SECRET", "")
        if not segredo:
            # Sem o segredo não há como conferir HS256 — e a chave pública do
            # JWKS NÃO serve de segredo. Vai pela rede.
            raise NaoDaParaConferir("token HS256 e SUPABASE_JWT_SECRET não configurado")
        material, algoritmos = segredo, ["HS256"]

    else:
        raise NaoDaParaConferir(f"algoritmo não aceito: {alg!r}")

    return _pyjwt.decode(
        token,
        material,
        algorithms=algoritmos,          # lista fechada: mata `alg: none` e confusão de algoritmo
        audience="authenticated",
        issuer=_url_base() + "/auth/v1",
        options={
            "require": ["exp", "sub"],
            "verify_signature": True,
            "verify_exp": True,
            "verify_aud": True,
            "verify_iss": True,
        },
    )
