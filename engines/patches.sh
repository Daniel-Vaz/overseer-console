#!/usr/bin/env bash
# Edits an engine's patch set as ordinary git commits.
#
#   engines/patches.sh <fo1|fo2> import   # patches -> .cache/engines/<id>-dev (one commit each)
#   engines/patches.sh <fo1|fo2> export   # commits in that tree -> engines/<name>/patches/
#
# Workflow: import, change the code in the dev tree, commit or amend there
# (rebase onto a newer upstream commit the same way), then export. The commit
# message becomes the text at the top of the patch file.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() { printf '%s\n' "$*" >&2; exit 1; }

id="${1:-}"
action="${2:-}"
case "${id}" in
    fo1) name=fallout1 ;;
    fo2) name=fallout2 ;;
    *) die "usage: engines/patches.sh <fo1|fo2> <import|export>" ;;
esac

# shellcheck disable=SC1090
source "${ROOT}/engines/${name}/source.env"
patches="${ROOT}/engines/${name}/patches"
dev="${ROOT}/.cache/engines/${id}-dev"
# Commits in the dev tree are scaffolding; their author never reaches a patch.
commit=(git -C "${dev}" -c user.name=overseer-console -c user.email=noreply@invalid -c commit.gpgsign=false)

case "${action}" in
    import)
        [[ -e "${dev}" ]] && die "${dev} already exists; delete it first if you want a fresh tree"
        mkdir -p "${dev}"
        git -C "${dev}" init -q
        git -C "${dev}" remote add origin "${ENGINE_REPO}"
        git -C "${dev}" fetch -q --depth 1 origin "${ENGINE_REF}"
        git -C "${dev}" checkout -q -b patches "${ENGINE_REF}"
        for patch in "${patches}"/*.patch; do
            [[ -e "${patch}" ]] || continue
            git -C "${dev}" apply --index --whitespace=nowarn "${patch}"
            # Everything above the first "---" line is the commit message.
            sed '/^---$/,$d' "${patch}" | "${commit[@]}" commit -q -F -
            echo "imported $(basename "${patch}")"
        done
        echo "dev tree: ${dev}"
        ;;
    export)
        [[ -d "${dev}/.git" ]] || die "no dev tree at ${dev}; run import first"
        [[ -z "$(git -C "${dev}" status --porcelain)" ]] || die "the dev tree has uncommitted changes"
        mkdir -p "${patches}"
        find "${patches}" -maxdepth 1 -name '*.patch' -delete
        n=0
        for rev in $(git -C "${dev}" rev-list --reverse "${ENGINE_REF}..HEAD"); do
            n=$((n + 1))
            subject="$(git -C "${dev}" log -1 --format=%s "${rev}")"
            slug="$(printf '%s' "${subject}" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"
            file="$(printf '%04d-%s.patch' "${n}" "${slug}")"
            {
                git -C "${dev}" log -1 --format=%B "${rev}" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'
                echo '---'
                git -C "${dev}" diff --no-color "${rev}~1" "${rev}"
            } > "${patches}/${file}"
            echo "exported ${file}"
        done
        ;;
    *)
        die "usage: engines/patches.sh <fo1|fo2> <import|export>"
        ;;
esac
