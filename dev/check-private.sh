#!/usr/bin/env bash
# Fails when a file that would be published (tracked, or untracked and not ignored) contains
# installation-specific information. The patterns live in the untracked PRIVATE.md, in a fenced block
# marked `private-patterns` (one extended regular expression per line, case-insensitive), so this
# public script never reveals them. Usage: dev/check-private.sh (task privacy)
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO"
PRIVATE=${MU_PRIVATE_FILE:-PRIVATE.md}

if [[ ! -f $PRIVATE ]]; then
	echo "privacy: no $PRIVATE, nothing to check against (maintainers keep the patterns there)"
	exit 0
fi
if git ls-files --error-unmatch "$PRIVATE" >/dev/null 2>&1 || ! git check-ignore -q "$PRIVATE"; then
	echo "privacy: $PRIVATE is not ignored by git — add it to .gitignore" >&2
	exit 1
fi

patterns=$(awk '/^```private-patterns[[:space:]]*$/ { inside = 1; next } inside && /^```/ { inside = 0 } inside && NF' "$PRIVATE")
if [[ -z $patterns ]]; then
	echo "privacy: no private-patterns block in $PRIVATE" >&2
	exit 1
fi

mapfile -t files < <(git ls-files --cached --others --exclude-standard | while IFS= read -r f; do [[ -f $f ]] && echo "$f"; done)
((${#files[@]})) || {
	echo "privacy: no files to check"
	exit 0
}

status=0
matches=$(grep -inE -f <(printf '%s\n' "$patterns") -- "${files[@]}") || status=$?
case $status in
	0)
		echo "privacy: installation-specific information in published files:" >&2
		echo "$matches" >&2
		echo "privacy: rephrase neutrally and move the details to $PRIVATE" >&2
		exit 1
		;;
	1) echo "privacy: ${#files[@]} published file(s) clean" ;;
	*)
		echo "privacy: grep failed (status $status), check the patterns in $PRIVATE" >&2
		exit 1
		;;
esac
