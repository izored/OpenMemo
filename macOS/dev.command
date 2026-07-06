#!/usr/bin/env bash
#
# dev.command — double-click launcher for macOS dev mode.
#
# Finder runs a .command file in Terminal on double-click. This just hands off
# to dev-mac.sh (its sibling in macOS/) so you don't need to open a shell.
#
# First time only:  chmod +x macOS/dev.command macOS/*.sh
#
cd "$(dirname "$0")"
exec bash dev-mac.sh
