-- ==========================================
-- MIGRATION 0071: Cadastro de condôminos (fonte de verdade p/ verificar 2ª via)
-- Verificação por CPF + responsável pelo pagamento; boleto só p/ e-mail cadastrado.
-- ==========================================
CREATE TABLE IF NOT EXISTS public.condominos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id   uuid REFERENCES public.condominios(id) ON DELETE CASCADE,
  unidade         text NOT NULL,
  bloco           text,
  tipo            text CHECK (tipo IN ('proprietario', 'locatario')),
  nome            text,
  cpf             text,            -- só dígitos (normalizado)
  telefone        text,           -- só dígitos
  email           text,
  responsavel_pagamento boolean NOT NULL DEFAULT false,  -- quem pode pedir a 2ª via
  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_condominos_cpf      ON public.condominos(cpf);
CREATE INDEX IF NOT EXISTS idx_condominos_unidade  ON public.condominos(condominio_id, unidade, bloco);

ALTER TABLE public.condominos ENABLE ROW LEVEL SECURITY;
-- Dados pessoais (LGPD): leitura/escrita só pelo backend (service-role). RLS sem policy pública.
