#!/bin/bash
# ─────────────────────────────────────────────────────────────
# deploy.sh — e3Argos Dashboard → GitHub Pages
# Uso: bash deploy.sh
#      bash deploy.sh "mensaje de commit opcional"
# ─────────────────────────────────────────────────────────────

set -e  # para si algo falla

REPO_URL="https://github.com/etrialabs/e3Argos.git"
BRANCH="main"
MSG="${1:-deploy $(date '+%Y-%m-%d %H:%M')}"

echo "▶ Subiendo dashboard a GitHub Pages..."
echo "  Branch : $BRANCH"
echo "  Mensaje: $MSG"
echo ""

# Asegura que estamos en la carpeta correcta
cd "$(dirname "$0")"

# Inicializa git si no existe
if [ ! -d ".git" ]; then
  echo "→ Inicializando repo git local..."
  git init
  git remote add origin "$REPO_URL"
fi

# Añade todos los archivos del dashboard y hace commit+push
git add -A
git commit -m "$MSG" || echo "  (nada nuevo que commitear)"
git push origin "$BRANCH" --force

echo ""
echo "✓ Dashboard publicado en GitHub Pages"
echo "  https://etrialabs.github.io/e3Argos/"
