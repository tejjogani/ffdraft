#!/bin/sh
# Pavé installer for macOS and Linux. It only checks that Node.js is present, then hands over
# to scripts/install.mjs, which does the same work on every operating system.
#
#   ./install.sh            install, build and check
#   ./install.sh --render   also install the photoreal renderer (about 1 GB)
#   ./install.sh --start    start Pavé afterwards
set -eu

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Pavé needs Node.js 22 or newer, and it is not installed."
  echo
  echo "Install it one of these ways, then run ./install.sh again:"
  echo "  - the LTS installer from https://nodejs.org"
  if [ "$(uname)" = "Darwin" ]; then
    echo "  - Homebrew:  brew install node@22"
  else
    echo "  - your package manager, or nvm:  https://github.com/nvm-sh/nvm"
  fi
  exit 1
fi

exec node scripts/install.mjs "$@"
