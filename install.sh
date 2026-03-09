#!/usr/bin/env bash

set -euo pipefail

APP_NAME="养养龙虾.app"
ZIP_NAME="养养龙虾.app.zip"
INSTALL_DIR="/Applications"
TMP_DIR="$(mktemp -d /tmp/yanglongxia-install.XXXXXX)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

print_usage() {
  cat <<'EOF'
Usage:
  ./install.sh [zip-file-or-url]

Examples:
  ./install.sh
  ./install.sh /path/to/养养龙虾.app.zip
  ./install.sh https://example.com/养养龙虾.app.zip

Behavior:
  - If no argument is given, the script looks for 养养龙虾.app.zip next to install.sh.
  - Installs the app into /Applications.
  - Removes macOS quarantine flags after install.
EOF
}

SOURCE_INPUT="${1:-}"

if [[ "${SOURCE_INPUT}" == "--help" || "${SOURCE_INPUT}" == "-h" ]]; then
  print_usage
  exit 0
fi

SOURCE_PATH=""

if [[ -n "${SOURCE_INPUT}" ]]; then
  SOURCE_PATH="${SOURCE_INPUT}"
elif [[ -f "${SCRIPT_DIR}/${ZIP_NAME}" ]]; then
  SOURCE_PATH="${SCRIPT_DIR}/${ZIP_NAME}"
else
  echo "Error: ${ZIP_NAME} not found next to install.sh, and no zip file or URL was provided." >&2
  exit 1
fi

ZIP_PATH="${TMP_DIR}/${ZIP_NAME}"

if [[ "${SOURCE_PATH}" =~ ^https?:// ]]; then
  echo "Downloading ${ZIP_NAME}..."
  curl -fL "${SOURCE_PATH}" -o "${ZIP_PATH}"
else
  if [[ ! -f "${SOURCE_PATH}" ]]; then
    echo "Error: zip file not found: ${SOURCE_PATH}" >&2
    exit 1
  fi
  cp "${SOURCE_PATH}" "${ZIP_PATH}"
fi

echo "Extracting ${ZIP_NAME}..."
ditto -x -k "${ZIP_PATH}" "${TMP_DIR}/unpack"

APP_PATH="${TMP_DIR}/unpack/${APP_NAME}"
if [[ ! -d "${APP_PATH}" ]]; then
  echo "Error: ${APP_NAME} was not found inside the zip archive." >&2
  exit 1
fi

echo "Installing to ${INSTALL_DIR}/${APP_NAME}..."
rm -rf "${INSTALL_DIR}/${APP_NAME}"
cp -R "${APP_PATH}" "${INSTALL_DIR}/${APP_NAME}"

echo "Removing quarantine flags..."
xattr -dr com.apple.quarantine "${INSTALL_DIR}/${APP_NAME}" 2>/dev/null || true

echo "Installed: ${INSTALL_DIR}/${APP_NAME}"
echo "Opening app..."
open "${INSTALL_DIR}/${APP_NAME}"
