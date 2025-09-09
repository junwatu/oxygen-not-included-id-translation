#!/usr/bin/env bash
set -euo pipefail

OMEGAT=0
for arg in "$@"; do
  case "$arg" in
    --omegat)
      OMEGAT=1
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [--omegat]"
      echo "  --omegat   Also install OmegaT (optional CAT tool)"
      exit 0
      ;;
  esac
done

if ! command -v brew >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Homebrew is required but not found.
Install it first:
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
Then re-run this script.
EOF
  exit 1
fi

echo "[1/4] Installing gettext (msgfmt, msgattrib, etc.) via Homebrew..."
if brew list --formula gettext >/dev/null 2>&1; then
  echo "gettext already installed"
else
  brew install gettext
fi

echo "[2/4] Ensuring pipx is installed..."
if command -v pipx >/dev/null 2>&1; then
  echo "pipx already installed"
else
  brew install pipx
fi
pipx ensurepath || true

echo "[3/4] Installing Translate Toolkit (pocount, pofilter)..."
if pipx list 2>/dev/null | grep -q "package translate-toolkit"; then
  echo "translate-toolkit already installed via pipx"
else
  pipx install translate-toolkit
fi

if [ "$OMEGAT" -eq 1 ]; then
  echo "[4/4] Installing OmegaT (optional) via Homebrew cask..."
  if brew list --cask omegat >/dev/null 2>&1; then
    echo "OmegaT already installed"
  else
    brew install --cask omegat
  fi
else
  echo "[4/4] Skipping OmegaT (use --omegat to install)"
fi

BREW_PREFIX=$(brew --prefix)
GETTEXT_BIN="$BREW_PREFIX/opt/gettext/bin"
cat <<EOF

Done. Add gettext binaries to your PATH (Apple Silicon default shown):

  export PATH="$GETTEXT_BIN:\$PATH"

Put that line into your shell profile, e.g. ~/.zshrc, then start a new shell.

Quick test:
  msgfmt --version
  pocount --version

Project commands:
  make all     # sync .po, compile .mo, run checks and stats
  make build   # compile only
  make check   # validate + QA checks
  make stats   # translation stats

EOF

