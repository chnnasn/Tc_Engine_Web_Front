#!/usr/bin/env bash
# 发布构建：优先复用/下载已构建的托管 Web 引擎产物，再构建网站。
#
# 托管引擎（.NET browser-wasm + Roslyn）需要 .NET 10 SDK + wasm-tools + CMake + Ninja，
# 明显重于旧的纯 Emscripten 构建，因此不在通用 CI 镜像里现场编译：
#   1. public/engine/<commit>/manifest.json 已存在  -> 直接复用
#   2. ENGINE_ARTIFACT_URL 已设置                   -> 下载并解包预构建产物
#   3. 否则                                          -> 在具备完整工具链的机器上本地构建
set -euo pipefail

commit=$(node -p "JSON.parse(require('fs').readFileSync('engine.lock.json','utf8')).commit")
engine_dir="public/engine/${commit}"

if [ -f "${engine_dir}/manifest.json" ]; then
  echo "复用已构建的引擎产物：${engine_dir}"
elif [ -n "${ENGINE_ARTIFACT_URL:-}" ]; then
  echo "下载预构建引擎产物：${ENGINE_ARTIFACT_URL}"
  mkdir -p "${engine_dir}"
  archive="$(mktemp -t tomcat-engine-XXXXXX)"
  curl -fsSL "${ENGINE_ARTIFACT_URL}" -o "${archive}"
  case "${ENGINE_ARTIFACT_URL}" in
    *.tar.gz|*.tgz) tar -xzf "${archive}" -C "${engine_dir}" ;;
    *.zip) unzip -q "${archive}" -d "${engine_dir}" ;;
    *) echo "无法识别的引擎产物格式（支持 .tar.gz/.tgz/.zip）：${ENGINE_ARTIFACT_URL}" >&2; exit 1 ;;
  esac
  rm -f "${archive}"
  # 允许压缩包内再套一层目录。
  if [ ! -f "${engine_dir}/manifest.json" ]; then
    nested=$(find "${engine_dir}" -maxdepth 2 -name manifest.json -print -quit)
    [ -n "${nested}" ] || { echo "引擎产物缺少 manifest.json" >&2; exit 1; }
    inner=$(dirname "${nested}")
    if [ "${inner}" != "${engine_dir}" ]; then
      shopt -s dotglob
      mv "${inner}"/* "${engine_dir}/"
      shopt -u dotglob
      rmdir "${inner}"
    fi
  fi
else
  echo "未找到引擎产物，改用本地工具链构建（需要 .NET 10 + wasm-tools + CMake + Ninja）"
  npm run engine:build
fi

[ -f "${engine_dir}/manifest.json" ] || { echo "构建后仍缺少 ${engine_dir}/manifest.json" >&2; exit 1; }
node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const lock = JSON.parse(readFileSync("engine.lock.json", "utf8"));
  const manifest = JSON.parse(readFileSync(`public/engine/${lock.commit}/manifest.json`, "utf8"));
  if (manifest.commit !== lock.commit || manifest.kind !== lock.kind || manifest.protocol !== lock.protocol) {
    throw new Error(`引擎产物与锁文件不一致：期望 ${lock.commit}，实际 ${manifest.commit}`);
  }
'

npm run build
node scripts/compress-engine.mjs

# 只发布锁定的引擎产物，剔除历史提交遗留的 bundle。
if [ -d dist/engine ]; then
  find dist/engine -mindepth 1 -maxdepth 1 -type d ! -name "${commit}" -exec rm -rf {} +
  echo "已发布引擎产物：$(ls dist/engine)"
fi
