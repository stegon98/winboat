#!/bin/bash
set -euo pipefail

echo "Building guest server..."

readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly GUEST_DIR="${ROOT_DIR}/guest_server"
readonly DIST_DIR="${GUEST_DIR}/dist"

VERSION="$(bun -p "require('./package.json').version")"
COMMIT_HASH="$(git rev-parse --short HEAD)"
BUILD_TIMESTAMP="$(date '+%Y-%m-%dT%H:%M:%S')"
LDFLAGS=(
  "-X main.Version=${VERSION}"
  "-X main.CommitHash=${COMMIT_HASH}"
  "-X main.BuildTimestamp=${BUILD_TIMESTAMP}"
)

echo "Version: ${VERSION}"
echo "Commit Hash: ${COMMIT_HASH}"
echo "Build Timestamp: ${BUILD_TIMESTAMP}"

cd "${GUEST_DIR}"

echo "Verifying nssm.exe integrity..."
if [ -f "nssm.exe" ] && [ -f "nssm.sha1.txt" ]; then
    if command -v sha1sum >/dev/null 2>&1; then
        COMPUTED_HASH="$(sha1sum nssm.exe | cut -d' ' -f1)"
    elif command -v shasum >/dev/null 2>&1; then
        COMPUTED_HASH="$(shasum -a 1 nssm.exe | cut -d' ' -f1)"
    else
        echo "Warning: no SHA-1 tool found (sha1sum/shasum), skipping integrity check"
        COMPUTED_HASH=""
    fi

    EXPECTED_HASH="$(tr -d '[:space:]' < nssm.sha1.txt)"

    if [ -z "${COMPUTED_HASH}" ]; then
        echo "Integrity check skipped because no SHA-1 tool is available"
    elif [ "${COMPUTED_HASH}" = "${EXPECTED_HASH}" ]; then
        echo "OK nssm.exe integrity verified (SHA-1: ${COMPUTED_HASH})"
    else
        echo "ERROR nssm.exe integrity check failed"
        echo "  Expected: ${EXPECTED_HASH}"
        echo "  Computed: ${COMPUTED_HASH}"
        exit 1
    fi
else
    echo "Warning: nssm.exe or nssm.sha1.txt not found, skipping integrity check"
fi

rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

copy_payload_files() {
    local payload_dir="$1"
    cp install.bat "${payload_dir}/install.bat"
    cp nssm.exe "${payload_dir}/nssm.exe"
    cp nssm.sha1.txt "${payload_dir}/nssm.sha1.txt"
    cp RDPApps.reg "${payload_dir}/RDPApps.reg"
    mkdir -p "${payload_dir}/scripts"
    cp -R scripts/. "${payload_dir}/scripts/"
}

build_arch() {
    local arch="$1"
    local payload_dir="${DIST_DIR}/${arch}"

    mkdir -p "${payload_dir}"

    GOOS=windows GOARCH="${arch}" go build -ldflags="${LDFLAGS[*]}" -o "${payload_dir}/winboat_guest_server.exe" *.go

    copy_payload_files "${payload_dir}"

    (
        cd "${payload_dir}"
        rm -f winboat_guest_server.zip
        zip -r winboat_guest_server.zip \
            winboat_guest_server.exe \
            install.bat \
            nssm.exe \
            nssm.sha1.txt \
            RDPApps.reg \
            scripts >/dev/null
    )

    cp "${payload_dir}/winboat_guest_server.zip" "${DIST_DIR}/winboat_guest_server_${arch}.zip"

    echo "Built guest server payload for windows/${arch}: ${payload_dir}"
}

build_arch amd64
build_arch arm64

# Legacy compatibility output (amd64)
cp "${DIST_DIR}/amd64/winboat_guest_server.exe" "${GUEST_DIR}/winboat_guest_server.exe"
cp "${DIST_DIR}/amd64/winboat_guest_server.zip" "${GUEST_DIR}/winboat_guest_server.zip"

echo "Guest server artifacts ready:"
echo "  ${DIST_DIR}/amd64/winboat_guest_server.zip"
echo "  ${DIST_DIR}/arm64/winboat_guest_server.zip"
echo "  ${DIST_DIR}/winboat_guest_server_amd64.zip"
echo "  ${DIST_DIR}/winboat_guest_server_arm64.zip"
echo "Legacy compatibility artifact: ${GUEST_DIR}/winboat_guest_server.zip"
