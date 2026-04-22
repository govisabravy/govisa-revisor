#!/bin/bash
# Carrega credenciais do vault ~/.credentials/clients/govisa.env
# Uso: source scripts/load-env.sh && npm run dev
# OBS: não commitamos .env.local. Credenciais vivem no vault.

VAULT="$HOME/.credentials/clients/govisa.env"

if [ ! -f "$VAULT" ]; then
  echo "⚠️  vault não encontrado em $VAULT"
  exit 1
fi

# Exporta apenas as vars que o app precisa (não todas do vault)
export ANTHROPIC_API_KEY=$(awk -F= '/^ANTHROPIC_API_KEY=/ {print $2}' "$VAULT")
export ANTHROPIC_MODEL=$(awk -F= '/^ANTHROPIC_MODEL=/ {print $2}' "$VAULT")

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "⚠️  ANTHROPIC_API_KEY não encontrada no vault"
  exit 1
fi

echo "✅ credenciais carregadas do vault"
