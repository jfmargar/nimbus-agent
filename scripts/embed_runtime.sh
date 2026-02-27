#!/usr/bin/env bash
set -euo pipefail

EMBED_ROOT="${SRCROOT}/Embedded"
APP_RES="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}"
AIPAL_DEST="${APP_RES}/aipal"
RUNTIME_DEST="${APP_RES}/runtime"
SIGNING_IDENTITY="${EXPANDED_CODE_SIGN_IDENTITY:-${CODE_SIGN_IDENTITY:-}}"
NODE_ENTITLEMENTS="${SRCROOT}/scripts/node_runtime.entitlements"

if [[ ! -d "${EMBED_ROOT}/aipal" ]] || [[ ! -f "${EMBED_ROOT}/runtime/node" ]]; then
  echo "error: Embedded runtime missing. Run scripts/prepare_embedded_runtime.sh first."
  exit 1
fi

mkdir -p "${AIPAL_DEST}" "${RUNTIME_DEST}"

rsync -a --delete "${EMBED_ROOT}/aipal/" "${AIPAL_DEST}/"
rsync -a --delete "${EMBED_ROOT}/runtime/" "${RUNTIME_DEST}/"

chmod +x "${RUNTIME_DEST}/node"

# Biome is a dev-only tool and should not be shipped in the notarized bundle.
rm -rf "${AIPAL_DEST}/node_modules/@biomejs"
rm -f "${AIPAL_DEST}/node_modules/.bin/biome"

if [[ -z "${SIGNING_IDENTITY}" ]]; then
  echo "warning: No code signing identity available for nested runtime signing"
  exit 0
fi

sign_macho_file() {
  local target="$1"
  if [[ "$#" -gt 1 ]]; then
    shift
    codesign --force --sign "${SIGNING_IDENTITY}" --options runtime --timestamp=none "$@" "${target}"
  else
    codesign --force --sign "${SIGNING_IDENTITY}" --options runtime --timestamp=none "${target}"
  fi
  echo "Signed nested runtime binary: ${target}"
}

while IFS= read -r -d '' candidate; do
  if [[ "${candidate}" == "${RUNTIME_DEST}/node" ]]; then
    continue
  fi
  if file -b "${candidate}" | grep -q 'Mach-O'; then
    sign_macho_file "${candidate}"
  fi
done < <(find "${RUNTIME_DEST}" "${AIPAL_DEST}" -type f -print0)

if [[ -f "${RUNTIME_DEST}/node" ]]; then
  sign_macho_file "${RUNTIME_DEST}/node" --entitlements "${NODE_ENTITLEMENTS}"
fi
