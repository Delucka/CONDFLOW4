"""Envio de e-mail pelo NOSSO servidor (SMTP), não pelo Supabase.

O provedor vem das variáveis de ambiente, não do código:

    SMTP_HOST  smtp.hostinger.com   (padrão histórico: smtp.gmail.com)
    SMTP_PORT  465 = SSL direto · 587 = STARTTLS
    SMTP_USER  a caixa que envia — vira também o remetente do e-mail
    SMTP_PASS  a senha dessa caixa

`GMAIL_USER` / `GMAIL_APP_PASSWORD` continuam funcionando como segunda opção,
para a migração não exigir trocar tudo no mesmo minuto.

Best-effort por decisão: e-mail que não sai não pode derrubar a operação que o
disparou — um convite de acesso falhar não desfaz o cadastro do usuário. Por
isso estas funções devolvem True/False e não levantam.
"""

from log import log

def _enviar_email_smtp(to: str, subject: str, html: str, cc=None, anexos=None) -> bool:
    """Envia e-mail HTML via SMTP. cc=lista de e-mails; anexos=lista de (nome, bytes, mime).
    Best-effort: retorna True/False, não levanta."""
    import os, smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from email.mime.application import MIMEApplication

    # Usuario e senha andam em PAR.
    #
    # Antes cada um caia para o Gmail por conta propria: com SMTP_USER
    # preenchido e SMTP_PASS vazio, o codigo tentava entrar na caixa nova com a
    # senha da antiga — e todo e-mail do sistema parava, calado. Meia
    # configuracao agora e a mesma coisa que nenhuma.
    # O SERVIDOR anda junto do par tambem. Deixar SMTP_HOST valer na queda para
    # o Gmail seria pedir para entrar no servidor de um provedor com a senha de
    # outro — que e o mesmo erro, so que mais dificil de enxergar no log.
    if os.getenv("SMTP_USER") and os.getenv("SMTP_PASS"):
        smtp_user, smtp_pass = os.getenv("SMTP_USER"), os.getenv("SMTP_PASS")
        host = os.getenv("SMTP_HOST", "smtp.gmail.com")
        port = int(os.getenv("SMTP_PORT", "465"))
    else:
        smtp_user, smtp_pass = os.getenv("GMAIL_USER"), os.getenv("GMAIL_APP_PASSWORD")
        host, port = "smtp.gmail.com", 465
    if not smtp_user or not smtp_pass:
        log.warning("[email] SMTP não configurado (defina SMTP_USER e SMTP_PASS)")
        return False
    from_name = os.getenv("EMAIL_FROM_NAME", "CondoFlow")
    cc = [c for c in (cc or []) if c]

    msg = MIMEMultipart("mixed")
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{smtp_user}>"
    msg["To"] = to
    if cc:
        msg["Cc"] = ", ".join(cc)
    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(html, "html", "utf-8"))
    msg.attach(alt)
    for item in (anexos or []):
        try:
            fn, data, mime = item
            sub = mime.split("/", 1)[1] if (mime and "/" in mime) else "octet-stream"
            part = MIMEApplication(data, _subtype=sub)
            part.add_header("Content-Disposition", "attachment", filename=fn)
            msg.attach(part)
        except Exception as _e:
            log.warning(f"[email] anexo falhou: {_e}")

    # A porta decide o tipo de conexão. 465 abre já cifrado; 587 começa em claro
    # e sobe para TLS com STARTTLS. Usar SMTP_SSL numa porta 587 não dá erro
    # claro — a conexão fica pendurada até o tempo acabar.
    try:
        if port == 587:
            with smtplib.SMTP(host, port, timeout=20) as s:
                s.starttls()
                s.login(smtp_user, smtp_pass)
                s.sendmail(smtp_user, [to] + cc, msg.as_string())
        else:
            with smtplib.SMTP_SSL(host, port, timeout=20) as s:
                s.login(smtp_user, smtp_pass)
                s.sendmail(smtp_user, [to] + cc, msg.as_string())
        return True
    except Exception as e:
        log.warning(f"[email] erro ao enviar para {to} por {host}:{port}: {e}")
        return False


def _enviar_email_acesso(db, email: str, full_name: str, password: str) -> bool:
    """Monta (template do pinguim) e envia o e-mail de acesso (login + senha) ao usuário."""
    try:
        primeiro = (full_name or "").strip().split(" ")[0]
        titulo = f"Bem-vindo(a), {primeiro}!" if primeiro else "Bem-vindo(a) ao CondoFlow!"
        pill = (
            "display:inline-block;font-family:ui-monospace,Menlo,Consolas,monospace;"
            "font-size:16px;font-weight:bold;background:#eef3fb;color:#142a63;"
            "padding:7px 14px;border-radius:8px;border:1px solid #d7e2f5;margin:4px 0 14px;"
        )
        corpo = (
            "Sua conta no CondoFlow foi criada. Use os dados abaixo para entrar:<br><br>"
            "<strong style=\"color:#0f1a3c;\">E-mail</strong><br>"
            f'<span style="{pill}">{email}</span><br>'
            "<strong style=\"color:#0f1a3c;\">Senha tempor&aacute;ria</strong><br>"
            f'<span style="{pill}">{password}</span>'
            "<br>No primeiro acesso, o sistema vai pedir para voc&ecirc; criar uma nova senha."
        )
        html = db.rpc("email_template", {"p_titulo": titulo, "p_mensagem": corpo, "p_link": "/login"}).execute().data
        if isinstance(html, str) and html:
            return _enviar_email_smtp(email, "Bem-vindo ao CondoFlow — seus dados de acesso", html)
    except Exception as e:
        log.warning(f"[enviar_acesso] falha: {e}")
    return False


def _enviar_email_recuperacao(db, email: str, full_name: str, link: str) -> bool:
    """E-mail de 'esqueci minha senha' enviado pelo NOSSO Gmail (não pelo Supabase).
    O link de recuperação vai COMPLETO no corpo (o botão do template prefixa a base)."""
    try:
        primeiro = (full_name or "").strip().split(" ")[0]
        saud = f"Ol&aacute;, {primeiro}!" if primeiro else "Ol&aacute;!"
        btn = (
            f'<div style="margin:18px 0;"><a href="{link}" '
            'style="display:inline-block;background:#142a63;color:#ffffff;font-size:15px;'
            'font-weight:bold;padding:13px 30px;border-radius:10px;text-decoration:none;">'
            'Criar nova senha</a></div>'
        )
        corpo = (
            f"{saud}<br><br>"
            "Recebemos um pedido para redefinir a senha da sua conta no CondoFlow. "
            "Clique no bot&atilde;o abaixo para criar uma nova senha (o link expira em 1 hora):"
            f"{btn}"
            "Se voc&ecirc; n&atilde;o pediu isso, pode ignorar este e-mail com seguran&ccedil;a."
        )
        html = db.rpc("email_template", {"p_titulo": "Redefinir sua senha", "p_mensagem": corpo, "p_link": None}).execute().data
        if isinstance(html, str) and html:
            return _enviar_email_smtp(email, "CondoFlow — Redefinir senha", html)
    except Exception as e:
        log.warning(f"[email_recuperacao] falha: {e}")
    return False
