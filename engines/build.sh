#!/usr/bin/env bash
# Builds the WebAssembly engines from pinned upstream commits.
#
#   engines/build.sh [fo1|fo2|all]
#
# For each engine: check out the commit named in engines/<name>/source.env,
# apply engines/<name>/patches/*.patch, compile inside the official Emscripten
# container, and copy the result to public/engines/<id>/.
#
# Needs git plus podman or docker. Nothing else is installed on the host.
# Environment:
#   CONTAINER_RUNTIME  podman | docker (default: whichever is found first)
#   JOBS               parallel compile jobs (default: number of CPUs)
#   EXTRA_LINK_FLAGS   appended to the link line, for diagnostics
#                      (e.g. --profiling-funcs to keep function names)
#   FORCE              set to rebuild even when nothing changed
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EMSDK_VERSION="4.0.4"
IMAGE="docker.io/emscripten/emsdk:${EMSDK_VERSION}"
CACHE_DIR="${ROOT}/.cache"
OUT_DIR="${ROOT}/public/engines"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 4)}"

# Flags shared by both engines. See engines/lib/overseer.js for what they do.
#  - every look at the clock goes through the glue's watchdog
#  - the glue itself, a roomy unwind buffer for Asyncify (the watchdog can
#    suspend the engine from deep call stacks), the runtime methods the host
#    page needs, and SDL's real tick counter for the glue to line up with
#    (--undefined pulls it out of the SDL2 archive even when, after the
#    rename above, nothing else in the link refers to it)
#  - SDL's text input switch, which the games turn on while they wait for
#    typing (a save's description, a character's name): the host page shows
#    its on-screen keyboard for touch players exactly then
COMPILE_FLAGS="-DSDL_GetTicks=overseer_ticks"
LINK_FLAGS="--js-library=/glue/overseer.js -sASYNCIFY_STACK_SIZE=1048576 -sEXPORTED_RUNTIME_METHODS=callMain,FS -sEXPORTED_FUNCTIONS=_main,_SDL_GetTicks,_SDL_IsTextInputActive,_SDL_StopTextInput -Wl,--undefined=SDL_GetTicks -Wl,--undefined=SDL_IsTextInputActive -Wl,--undefined=SDL_StopTextInput"

log() { printf '\033[1;32m[engines]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[engines]\033[0m %s\n' "$*" >&2; exit 1; }

runtime() {
    if [[ -n "${CONTAINER_RUNTIME:-}" ]]; then
        echo "${CONTAINER_RUNTIME}"
    elif command -v podman >/dev/null 2>&1; then
        echo podman
    elif command -v docker >/dev/null 2>&1; then
        echo docker
    else
        die "podman or docker is required"
    fi
}

# Runs a command inside the Emscripten container as the calling user.
in_container() {
    local rt user_args=()
    rt="$(runtime)"
    if [[ "$(basename "${rt}")" == podman* ]]; then
        user_args=(--userns=keep-id)
    else
        user_args=(--user "$(id -u):$(id -g)")
    fi
    "${rt}" run --rm "${user_args[@]}" -e HOME=/tmp -e JOBS="${JOBS}" "$@"
}

# The image ships a prebuilt sysroot in its Emscripten cache. Copy it to the
# host once so that ports built later (SDL2, zlib) survive between runs.
prepare_em_cache() {
    local em_cache="${CACHE_DIR}/emscripten"
    if [[ ! -d "${em_cache}/sysroot" ]]; then
        log "seeding the Emscripten cache (first run only)"
        mkdir -p "${em_cache}"
        in_container -v "${em_cache}:/seed" "${IMAGE}" \
            bash -c 'cp -a /emsdk/upstream/emscripten/cache/. /seed/'
    fi
}

# Fingerprint of everything that decides what a build produces.
inputs_hash() {
    local name="$1"
    {
        echo "${EMSDK_VERSION} ${COMPILE_FLAGS} ${LINK_FLAGS} ${EXTRA_LINK_FLAGS:-}"
        cat "${ROOT}/engines/build.sh" "${ROOT}/engines/${name}/source.env" "${ROOT}/engines/lib/"*.js "${ROOT}/engines/lib/"*.py
        cat "${ROOT}/engines/${name}/patches/"*.patch 2>/dev/null || true
    } | sha256sum | cut -c1-16
}

# checkout <dir> <repo> <ref> <patches dir>
checkout() {
    local dir="$1" repo="$2" ref="$3" patches="$4"
    mkdir -p "${dir}"
    if [[ ! -d "${dir}/.git" ]]; then
        git -C "${dir}" init -q
        git -C "${dir}" remote add origin "${repo}"
    fi
    if ! git -C "${dir}" cat-file -e "${ref}^{commit}" 2>/dev/null; then
        log "fetching ${repo} @ ${ref:0:12}"
        git -C "${dir}" fetch -q --depth 1 origin "${ref}"
    fi
    # This directory belongs to the script: always start from the pristine commit.
    git -C "${dir}" checkout -q -f --detach "${ref}"
    git -C "${dir}" clean -q -fdx
    local patch
    for patch in "${patches}"/*.patch; do
        [[ -e "${patch}" ]] || continue
        log "applying $(basename "${patch}")"
        git -C "${dir}" apply --whitespace=nowarn "${patch}"
    done
}

# build <id> <engine dir name> <ports used, comma separated> <extra cmake args...>
build() {
    local id="$1" name="$2" ports="$3"
    shift 3
    local engine_dir="${ROOT}/engines/${name}"
    local src="${CACHE_DIR}/engines/${id}/src"
    local build_dir="${CACHE_DIR}/engines/${id}/build"
    local out="${OUT_DIR}/${id}"

    # shellcheck disable=SC1091
    source "${engine_dir}/source.env"

    local inputs
    inputs="$(inputs_hash "${name}")"
    if [[ -z "${FORCE:-}" && -f "${out}/${ENGINE_OUTPUT}.wasm" && -f "${out}/${ENGINE_OUTPUT}.js" ]] &&
        grep -qs "\"inputs\": \"${inputs}\"" "${out}/engine.json"; then
        log "${id}: up to date"
        return
    fi

    log "${id}: ${ENGINE_REPO} @ ${ENGINE_REF:0:12}"
    checkout "${src}" "${ENGINE_REPO}" "${ENGINE_REF}" "${engine_dir}/patches"
    prepare_em_cache
    mkdir -p "${build_dir}" "${out}"

    local cmake_args=(
        -S /src -B /build
        -DCMAKE_BUILD_TYPE=Release
        "-DCMAKE_C_FLAGS=${COMPILE_FLAGS}"
        "-DCMAKE_CXX_FLAGS=${COMPILE_FLAGS}"
        # Appended after every other link option, so these win.
        "-DCMAKE_CXX_STANDARD_LIBRARIES=${LINK_FLAGS}${EXTRA_LINK_FLAGS:+ ${EXTRA_LINK_FLAGS}}"
        "$@"
    )

    log "${id}: compiling (emsdk ${EMSDK_VERSION}, ${JOBS} jobs)"
    in_container \
        -v "${src}:/src" \
        -v "${build_dir}:/build" \
        -v "${ROOT}/engines/lib:/glue:ro" \
        -v "${CACHE_DIR}/emscripten:/emsdk/upstream/emscripten/cache" \
        -w /build "${IMAGE}" \
        bash -euo pipefail -c '
            git config --global --add safe.directory "*"
            emcmake cmake "$@" > configure.log 2>&1 || { tail -40 configure.log; exit 1; }
            cmake --build /build -j "${JOBS}" > build.log 2>&1 || { grep -n -E "error|Error" build.log | head -40; tail -20 build.log; exit 1; }
        ' build "${cmake_args[@]}" || die "${id}: build failed (logs in ${build_dir})"

    # If SDL's tick counter did not make it into the binary, Emscripten quietly
    # substitutes its JavaScript SDL 1.2 emulation, which runs on another clock.
    if grep -q 'SDL\.startTime' "${build_dir}/${ENGINE_OUTPUT}.js"; then
        die "${id}: the build fell back to Emscripten's legacy JavaScript SDL"
    fi

    cp "${build_dir}/${ENGINE_OUTPUT}.js" "${build_dir}/${ENGINE_OUTPUT}.wasm" "${out}/"
    pack_engine_data "${src}" "${out}"
    write_manifest "${id}" "${out}" "${inputs}"
    # shellcheck disable=SC2086
    write_licenses "${id}" "${src}" "${build_dir}" "${out}" ${ports//,/ }
    log "${id}: $(du -h "${out}/${ENGINE_OUTPUT}.wasm" | cut -f1) wasm -> ${out#"${ROOT}/"}"
}

# The Fallout 2 engine has a folder of data of its own (files/ce.dat in its
# source): the pictures and words of what it adds to the game. It looks for
# them beside the game as an archive called ce.dat. Packed here; the site
# puts it beside the games that are played with it.
#   pack_engine_data <src> <out>
ENGINE_DATA="ce.dat"
pack_engine_data() {
    local src="$1" out="$2"
    rm -f "${out}/${ENGINE_DATA}"
    [[ -d "${src}/files/${ENGINE_DATA}" ]] || return 0
    in_container \
        -v "${src}:/src:ro" \
        -v "${out}:/out" \
        -v "${ROOT}/engines/lib:/glue:ro" \
        "${IMAGE}" python3 /glue/pack-dat.py "/src/files/${ENGINE_DATA}" "/out/${ENGINE_DATA}" ||
        die "packing ${ENGINE_DATA} failed"
}

# Describes the build for the site (which file to load, what it was built from).
write_manifest() {
    local id="$1" out="$2" inputs="$3" hash data=""
    [[ -f "${out}/${ENGINE_DATA}" ]] && data="${out}/${ENGINE_DATA}"
    # shellcheck disable=SC2086
    hash="$(cat "${out}/${ENGINE_OUTPUT}.js" "${out}/${ENGINE_OUTPUT}.wasm" ${data} | sha256sum | cut -c1-16)"
    cat > "${out}/engine.json" <<EOF
{
  "id": "${id}",
  "script": "${ENGINE_OUTPUT}.js",
  "wasm": "${ENGINE_OUTPUT}.wasm",
  "wasmBytes": $(stat -c %s "${out}/${ENGINE_OUTPUT}.wasm"),$([[ -n "${data}" ]] && printf '\n  "data": "%s",' "${ENGINE_DATA}")
  "hash": "${hash}",
  "inputs": "${inputs}",
  "source": "${ENGINE_REPO%.git}",
  "commit": "${ENGINE_REF}",
  "patched": $(compgen -G "${ROOT}/engines/$(engine_name "${id}")/patches/*.patch" >/dev/null && echo true || echo false),
  "emsdk": "${EMSDK_VERSION}"
}
EOF
}

# The engine licence requires its text to travel with every copy, and so do
# the licences of the libraries compiled in. Collect them next to the binary.
#   write_licenses <id> <src> <build dir> <out> <ports...>
write_licenses() {
    local id="$1" src="$2" build_dir="$3" out="$4"
    shift 4
    {
        echo "This is a modified build of the software below, made for"
        echo "https://github.com/Daniel-Vaz/overseer-console"
        echo "Source:  ${ENGINE_REPO%.git} at commit ${ENGINE_REF}"
        if compgen -G "${ROOT}/engines/$(engine_name "${id}")/patches/*.patch" >/dev/null; then
            echo "Changes: the patches in engines/$(engine_name "${id}")/patches, plus the glue in engines/lib"
        else
            echo "Changes: source unmodified; compiled and linked with the glue in engines/lib"
        fi
        echo
        cat "${src}/LICENSE.md"
    } > "${out}/LICENSE.txt"

    {
        echo "Third-party components compiled into this engine build."
        local file name port
        for file in "${src}"/third_party/*/LICENSE* "${build_dir}"/_deps/*-src/LICENSE*; do
            [[ -f "${file}" ]] || continue
            name="$(basename "$(dirname "${file}")")"
            # Vendored SDL2 is not used here: the browser build takes SDL2 from the ports below.
            [[ "${name}" == sdl2 ]] && continue
            # fetched dependencies duplicate the stubs in third_party/
            [[ "${file}" == "${src}"/third_party/* && -d "${build_dir}/_deps/${name}-src" ]] && continue
            printf '\n==== %s ====\n\n' "${name%-src}"
            cat "${file}"
        done
        for port in "$@"; do
            for file in "${CACHE_DIR}"/emscripten/ports/"${port}"/*/LICENSE* "${CACHE_DIR}"/emscripten/ports/"${port}"/*/COPYING*; do
                [[ -f "${file}" ]] || continue
                printf '\n==== %s (Emscripten port) ====\n\n' "${port}"
                cat "${file}"
            done
        done
        printf '\n==== Emscripten runtime ====\n\n'
        echo "MIT / University of Illinois NCSA licence: https://github.com/emscripten-core/emscripten/blob/${EMSDK_VERSION}/LICENSE"
    } > "${out}/THIRD-PARTY.txt"
}

engine_name() {
    case "$1" in
        fo1) echo fallout1 ;;
        fo2) echo fallout2 ;;
        *) die "unknown engine '$1' (expected fo1, fo2 or all)" ;;
    esac
}

build_engine() {
    case "$1" in
        fo1)
            build fo1 fallout1 sdl2
            ;;
        fo2)
            # Upstream ships its own toolchain file for the browser target.
            build fo2 fallout2 sdl2,sdl2_mixer,zlib,ogg,vorbis -DCMAKE_TOOLCHAIN_FILE=/src/cmake/toolchain/Emscripten.cmake
            ;;
        *)
            engine_name "$1" >/dev/null
            ;;
    esac
}

export JOBS
target="${1:-all}"
if [[ "${target}" == "all" ]]; then
    build_engine fo1
    build_engine fo2
else
    build_engine "${target}"
fi
