#!/usr/bin/env bash
set -euo pipefail
version=$(node -p "JSON.parse(require('fs').readFileSync('engine.lock.json','utf8')).emscripten")
if [ -z "${EMSDK:-}" ]; then
  if [ ! -d .engine/emsdk ]; then
    git clone --depth 1 --branch "$version" https://github.com/emscripten-core/emsdk.git .engine/emsdk
  fi
  .engine/emsdk/emsdk install "$version"
  .engine/emsdk/emsdk activate "$version"
  source .engine/emsdk/emsdk_env.sh
fi
npm run engine:build
npm run build
