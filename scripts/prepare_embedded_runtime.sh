#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AIPAL_SRC="${AIPAL_SRC:-${ROOT_DIR}/../../aipal}"
EMBEDDED_ROOT="${ROOT_DIR}/Embedded"
AIPAL_DEST="${EMBEDDED_ROOT}/aipal"
RUNTIME_DEST="${EMBEDDED_ROOT}/runtime"
NODE_BIN="${NIMBUS_NODE_BIN:-$(command -v node || true)}"

if [[ ! -d "${AIPAL_SRC}" ]]; then
  echo "Aipal source not found at ${AIPAL_SRC}"
  exit 1
fi

if [[ -z "${NODE_BIN}" || ! -x "${NODE_BIN}" ]]; then
  echo "Node binary not found. Set NIMBUS_NODE_BIN or install Node 24+."
  exit 1
fi

if [[ ! -f "${AIPAL_SRC}/package.json" ]]; then
  echo "Invalid Aipal source: package.json missing"
  exit 1
fi

pushd "${AIPAL_SRC}" >/dev/null
if [[ ! -d node_modules ]]; then
  echo "Installing production dependencies for embedded Aipal..."
  npm ci --omit=dev
fi
popd >/dev/null

mkdir -p "${AIPAL_DEST}" "${RUNTIME_DEST}"

rsync -a --delete \
  --exclude ".git" \
  --exclude "test" \
  --exclude "docs" \
  --exclude ".github" \
  --exclude "*.log" \
  --exclude "coverage" \
  "${AIPAL_SRC}/" "${AIPAL_DEST}/"

cp "${NODE_BIN}" "${RUNTIME_DEST}/node"
chmod +x "${RUNTIME_DEST}/node"

echo "Embedded runtime prepared:"
echo "  Aipal: ${AIPAL_DEST}"
echo "  Node : ${RUNTIME_DEST}/node"
