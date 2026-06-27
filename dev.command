#!/usr/bin/env bash
#
# dev.command — double-click launcher for macOS dev mode.
#
# Finder runs a .command file in Terminal on double-click. This just hands off
# to scripts/dev-mac.sh from the repo root so you don't need to open a shell.
#
# First time only:  chmod +x dev.command scripts/*.sh
#
cd "$(dirname "$0")"
exec bash scripts/dev-mac.sh
