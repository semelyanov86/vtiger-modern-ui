#!/usr/bin/env bash
# DEV link of the ModernUI sources into a local Vtiger 8.4 instance (CRM_ROOT/CRM_URL in .env).
#
#   dev/crm-link.sh link [--force]   connect src/ to the stand            (task crm:link)
#   dev/crm-link.sh unlink           disconnect, the stand DB is kept     (task crm:unlink)
#   dev/crm-link.sh status           where the links point, their state  (task crm:status)
#   dev/crm-link.sh smoke            smoke test of the stand itself       (task crm:smoke)
#
# How it works (docs/DEVELOPMENT.md):
# - each directory of dev/crm-mounts.txt is bind-mounted READ-ONLY at the same relative path of the CRM.
#   Symlinks do not work: vtiger compares realpath() of included files with its root directory;
# - PHP-FPM runs in its own mount namespace (systemd ProtectSystem), where a new bind mount arrives
#   writable, so the mount is remounted read-only inside every php*-fpm namespace too;
# - a single PHP file (language files) gets a stub that requires the real file: a bind mount of one
#   file goes stale as soon as an editor saves it through rename;
# - the mapped paths are excluded from git of the CRM in .git/info/exclude (local, never committed);
# - files in the way (a ModernUI installed from the ZIP) are moved to .local/crm-replaced/ with --force.
# Settings: .env of this repository (.env.example). sudo is needed for mount/umount/nsenter.
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
if [[ -f "$REPO/.env" ]]; then
	set -a
	# shellcheck disable=SC1091
	source "$REPO/.env"
	set +a
fi
CRM_ROOT=${CRM_ROOT:-}
CRM_ROOT=${CRM_ROOT%/}
CRM_URL=${CRM_URL:-}
CRM_PHP=${CRM_PHP:-php8.5}
MODULE=${MU_MODULE:-ModernUI}
SRC=${MU_SRC:-$REPO/src}
SRC=${SRC%/}
MAP=$REPO/dev/crm-mounts.txt
LOCAL=$REPO/.local
STATE=$LOCAL/crm-link.state
MARKER="ModernUI dev link"
EXCLUDE_BEGIN="# >>> $MARKER ($REPO, dev/crm-link.sh)"
EXCLUDE_END="# <<< $MARKER"
FORCE=0
CHANGED=0
STAMP=$(date +%F-%H%M%S)

die() {
	echo "crm-link: $*" >&2
	exit 1
}

warn() {
	echo "crm-link: $*" >&2
}

crm_version() {
	sed -n "s/^\$vtiger_current_version *= *'\([^']*\)'.*/\1/p" "$CRM_ROOT/vtigerversion.php" 2>/dev/null | head -1
}

check_crm() {
	[[ -n $CRM_ROOT && -n $CRM_URL ]] || die "set CRM_ROOT and CRM_URL in .env (see .env.example)"
	[[ -f "$CRM_ROOT/vtigerversion.php" && -f "$CRM_ROOT/config.inc.php" ]] || die "$CRM_ROOT is not a Vtiger CRM root"
}

check_target_version() {
	local version
	version=$(crm_version)
	[[ $version == 8.4* ]] || die "$CRM_ROOT runs Vtiger ${version:-?}, ModernUI needs Vtiger 8.4"
}

# Patterns of the mount map: no comments, no blanks; each one must be a safe relative path
# whose last component names the module, so a typo cannot mount over modules/ or languages/.
map_patterns() {
	local line
	while IFS= read -r line || [[ -n $line ]]; do
		line=${line%%#*}
		line=$(echo "$line" | sed 's/[[:space:]]*$//; s/^[[:space:]]*//')
		[[ -z $line ]] && continue
		[[ $line == /* || $line == *..* ]] && die "unsafe path in dev/crm-mounts.txt: $line"
		[[ $(basename "$line") == *"$MODULE"* ]] || die "dev/crm-mounts.txt: the last component of '$line' must contain $MODULE"
		echo "$line"
	done <"$MAP"
}

# Paths matching a pattern inside a base directory (relative to it), only existing ones.
expand_in() {
	local base=$1 pattern=$2
	[[ -d $base ]] || return 0
	(
		cd "$base"
		shopt -s nullglob
		# shellcheck disable=SC2206
		local matches=($pattern)
		local path
		for path in "${matches[@]}"; do
			[[ -e $path || -L $path ]] && echo "$path"
		done
	)
}

same_inode() {
	[[ $(stat -c '%d:%i' "$1" 2>/dev/null) == "$(stat -c '%d:%i' "$2" 2>/dev/null)" ]]
}

is_our_mount() {
	local rel=$1
	mountpoint -q "$CRM_ROOT/$rel" && same_inode "$CRM_ROOT/$rel" "$SRC/$rel"
}

is_our_stub() {
	[[ -f $1 && ! -L $1 ]] && grep -q "$MARKER" "$1" 2>/dev/null
}

host_ns=$(readlink /proc/$$/ns/mnt)

# Main PIDs of running php*-fpm services that live in a mount namespace of their own.
fpm_namespaced_pids() {
	local unit pid ns
	systemctl list-units --type=service --state=running --plain --no-legend 'php*-fpm.service' 2>/dev/null | awk '{print $1}' |
		while read -r unit; do
			pid=$(systemctl show -p MainPID --value "$unit")
			[[ $pid =~ ^[0-9]+$ && $pid -gt 0 ]] || continue
			ns=$(sudo -n readlink "/proc/$pid/ns/mnt" 2>/dev/null) || continue
			[[ $ns != "$host_ns" ]] && echo "$unit:$pid"
		done
}

remount_ro_in_fpm() {
	local target=$1 entry pid
	for entry in $(fpm_namespaced_pids); do
		pid=${entry#*:}
		sudo -n nsenter -t "$pid" -m -- mount -o remount,bind,ro "$target" ||
			die "cannot remount $target read-only in the namespace of ${entry%%:*}"
	done
}

fpm_mount_state() {
	local target=$1 entry pid opts states=()
	for entry in $(fpm_namespaced_pids); do
		pid=${entry#*:}
		opts=$(sudo -n nsenter -t "$pid" -m -- findmnt -no OPTIONS --mountpoint "$target" 2>/dev/null || true)
		if [[ -z $opts ]]; then
			states+=("${entry%%:*}: not visible")
		elif [[ ,$opts, == *,ro,* ]]; then
			states+=("${entry%%:*}: ro")
		else
			states+=("${entry%%:*}: WRITABLE")
		fi
	done
	local IFS=';'
	echo "${states[*]}"
}

state_add() {
	grep -qxF "$1" "$STATE.new" 2>/dev/null || echo "$1" >>"$STATE.new"
}

# Creates the missing directories of a relative path one by one and records them for unlink.
ensure_dir() {
	local rel=$1 path=""
	local IFS=/
	for part in $rel; do
		path=${path:+$path/}$part
		if [[ ! -d $CRM_ROOT/$path ]]; then
			mkdir "$CRM_ROOT/$path"
			state_add $'mkdir\t'"$path"
		fi
	done
}

move_aside() {
	local rel=$1 dest
	dest=$LOCAL/crm-replaced/$STAMP/$rel
	mkdir -p "$(dirname "$dest")"
	mv "$CRM_ROOT/$rel" "$dest"
	echo "  moved aside: $rel -> ${dest#"$REPO"/}"
}

in_the_way() {
	local rel=$1 what=$2
	((FORCE)) || die "$CRM_ROOT/$rel is $what (a ModernUI installed from the ZIP?). Run 'task crm:link -- --force' to move it to .local/crm-replaced/"
	move_aside "$rel"
}

link_dir() {
	local rel=$1 target=$CRM_ROOT/$1
	if is_our_mount "$rel"; then
		remount_ro_in_fpm "$target"
		state_add $'dir\t'"$rel"
		echo "  ok       $rel (already mounted)"
		return
	fi
	mountpoint -q "$target" && die "$target is a mount point of something else"
	if [[ -L $target || (-e $target && ! -d $target) ]]; then
		in_the_way "$rel" "not a directory"
	elif [[ -d $target && -n $(ls -A "$target") ]]; then
		in_the_way "$rel" "a non-empty directory"
	fi
	ensure_dir "$rel"
	sudo -n mount --bind -o ro "$SRC/$rel" "$target"
	remount_ro_in_fpm "$target"
	state_add $'dir\t'"$rel"
	CHANGED=1
	echo "  mounted  $rel"
}

link_file() {
	local rel=$1 target=$CRM_ROOT/$1 src=$SRC/$1
	[[ $rel == *.php ]] || die "$rel: only directories and PHP files can be linked, put it into a mapped directory"
	[[ $src != *"'"* && $src != *\\* ]] || die "unsupported characters in $src"
	if [[ -e $target || -L $target ]] && ! is_our_stub "$target"; then
		in_the_way "$rel" "a file that is not a ModernUI stub"
	fi
	ensure_dir "$(dirname "$rel")"
	local content
	content=$(printf '<?php\n// %s: generated by %s/dev/crm-link.sh, removed by `task crm:unlink`.\n// The real file is %s, edit it there.\nrequire '"'"'%s'"'"';\n' "$MARKER" "$REPO" "$src" "$src")
	if [[ ! -f $target ]] || [[ $(cat "$target") != "$content" ]]; then
		printf '%s\n' "$content" >"$target"
		CHANGED=1
		echo "  stub     $rel"
	else
		echo "  ok       $rel (stub)"
	fi
	state_add $'stub\t'"$rel"
}

exclude_file() {
	local path
	path=$(git -C "$CRM_ROOT" rev-parse --git-path info/exclude 2>/dev/null) || return 1
	[[ $path == /* ]] || path=$CRM_ROOT/$path
	echo "$path"
}

write_excludes() {
	local file block pattern
	file=$(exclude_file) || {
		warn "$CRM_ROOT is not a git checkout, no excludes written"
		return
	}
	mkdir -p "$(dirname "$file")"
	touch "$file"
	block=$EXCLUDE_BEGIN$'\n'
	while IFS= read -r pattern; do
		block+="/$pattern"$'\n'
	done < <(map_patterns)
	block+=$EXCLUDE_END
	awk -v begin="$EXCLUDE_BEGIN" -v end="$EXCLUDE_END" '
		$0 == begin { skip = 1; next }
		$0 == end { skip = 0; next }
		!skip { print }
	' "$file" >"$file.tmp"
	printf '%s\n' "$block" >>"$file.tmp"
	mv "$file.tmp" "$file"
}

clear_smarty() {
	# Compiled templates of a ZIP-installed copy may look newer than the mounted sources.
	rm -rf "$CRM_ROOT/test/templates_c/v7"
}

state_root() {
	[[ -f $STATE ]] && sed -n 's/^root\t//p' "$STATE" | head -1
}

cmd_link() {
	check_crm
	check_target_version
	sudo -n true 2>/dev/null || die "sudo without a password is needed for mount/nsenter"
	local old_root
	old_root=$(state_root || true)
	if [[ -n $old_root && $old_root != "$CRM_ROOT" ]]; then
		die "linked to $old_root; run 'task crm:unlink' with that CRM_ROOT first"
	fi
	mkdir -p "$LOCAL"
	: >"$STATE.new"
	printf 'root\t%s\n' "$CRM_ROOT" >>"$STATE.new"
	# Directories created by an earlier link stay recorded for unlink.
	if [[ -f $STATE ]]; then
		grep $'^mkdir\t' "$STATE" | while IFS=$'\t' read -r _ rel; do
			[[ -d $CRM_ROOT/$rel ]] && state_add $'mkdir\t'"$rel"
		done
	fi
	echo "ModernUI -> $CRM_ROOT (Vtiger $(crm_version), $CRM_URL)"
	local pattern rel found=0
	while IFS= read -r pattern; do
		local matched=0
		while IFS= read -r rel; do
			matched=1
			found=1
			if [[ -d $SRC/$rel ]]; then
				link_dir "$rel"
			else
				link_file "$rel"
			fi
		done < <(expand_in "$SRC" "$pattern")
		((matched)) || echo "  -        $pattern (no source yet)"
	done < <(map_patterns)
	mv "$STATE.new" "$STATE"
	write_excludes
	((CHANGED)) && clear_smarty
	((found)) || warn "nothing to link yet: $SRC has none of the mapped paths (the module appears at stage 02)"
	echo "Done. Edit the files in $SRC and reload $CRM_URL; 'task crm:unlink' disconnects."
}

cmd_unlink() {
	check_crm
	local root
	root=$(state_root || true)
	[[ -z $root || $root == "$CRM_ROOT" ]] || die "the links point to $root, run with CRM_ROOT=$root"
	local entries=()
	if [[ -f $STATE ]]; then
		mapfile -t entries < <(grep -v $'^root\t' "$STATE")
	fi
	# Leftovers that are not in the state file (it was lost): our mounts and stubs at mapped paths.
	local pattern rel
	while IFS= read -r pattern; do
		while IFS= read -r rel; do
			if is_our_mount "$rel"; then
				entries+=($'dir\t'"$rel")
			elif is_our_stub "$CRM_ROOT/$rel"; then
				entries+=($'stub\t'"$rel")
			fi
		done < <(expand_in "$CRM_ROOT" "$pattern")
	done < <(map_patterns)
	local i kind
	for ((i = ${#entries[@]} - 1; i >= 0; i--)); do
		kind=${entries[i]%%$'\t'*}
		rel=${entries[i]#*$'\t'}
		case $kind in
			dir)
				if mountpoint -q "$CRM_ROOT/$rel"; then
					sudo -n umount "$CRM_ROOT/$rel"
					CHANGED=1
					echo "  unmounted $rel"
				fi
				;;
			stub)
				if is_our_stub "$CRM_ROOT/$rel"; then
					rm -f "$CRM_ROOT/$rel"
					CHANGED=1
					echo "  removed   $rel"
				fi
				;;
			mkdir)
				if [[ -d $CRM_ROOT/$rel ]] && ! mountpoint -q "$CRM_ROOT/$rel" && [[ -z $(ls -A "$CRM_ROOT/$rel") ]]; then
					rmdir "$CRM_ROOT/$rel"
				fi
				;;
		esac
	done
	rm -f "$STATE"
	((CHANGED)) && clear_smarty
	echo "Unlinked from $CRM_ROOT. The excludes in git stay; the DB of the stand is not touched."
	if "$CRM_PHP" "$REPO/dev/crm-info.php" "$CRM_ROOT" "$MODULE" 2>/dev/null | grep -q "^  $MODULE: tabid .*, enabled"; then
		warn "$MODULE is still registered and enabled in the stand DB while its files are gone:"
		warn "link again, install the ZIP (PACKAGE) or disable/uninstall the module (docs/DEVELOPMENT.md)"
	fi
}

cmd_status() {
	check_crm
	local version head branch dirty http root
	version=$(crm_version)
	head=$(git -C "$CRM_ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')
	branch=$(git -C "$CRM_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')
	dirty=$(git -C "$CRM_ROOT" status --porcelain 2>/dev/null | wc -l)
	http=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$CRM_URL" || true)
	root=$(state_root || true)
	echo "CRM:     $CRM_ROOT — Vtiger ${version:-?}, git $branch @ $head, $dirty changed path(s) in git status"
	echo "URL:     $CRM_URL — HTTP ${http:-?}"
	echo "Sources: $SRC"
	echo "Linked:  ${root:-no}"
	echo "Paths:"
	local pattern rel any target
	while IFS= read -r pattern; do
		any=0
		while IFS= read -r rel; do
			any=1
			target=$CRM_ROOT/$rel
			if [[ -d $SRC/$rel ]]; then
				if is_our_mount "$rel"; then
					echo "  mounted ro  $rel [$(fpm_mount_state "$target")]"
				elif [[ -d $target && -n $(ls -A "$target" 2>/dev/null) ]]; then
					echo "  INSTALLED   $rel (real files: ZIP install, PACKAGE mode)"
				else
					echo "  not linked  $rel"
				fi
			else
				if is_our_stub "$target"; then
					echo "  stub        $rel"
				elif [[ -e $target ]]; then
					echo "  INSTALLED   $rel (real file: ZIP install, PACKAGE mode)"
				else
					echo "  not linked  $rel"
				fi
			fi
		done < <(expand_in "$SRC" "$pattern")
		# Files in the CRM without a source here (installed by a ZIP, or removed from src/).
		while IFS= read -r rel; do
			[[ -e $SRC/$rel ]] && continue
			any=1
			if is_our_stub "$CRM_ROOT/$rel"; then
				echo "  STALE stub  $rel (no source any more, task crm:link or crm:unlink)"
			elif mountpoint -q "$CRM_ROOT/$rel"; then
				echo "  MOUNTED     $rel (no source here)"
			elif [[ -d $CRM_ROOT/$rel && -z $(ls -A "$CRM_ROOT/$rel") ]]; then
				echo "  empty dir   $rel (mount point left after a reboot? task crm:link)"
			else
				echo "  INSTALLED   $rel (real files, no source here)"
			fi
		done < <(expand_in "$CRM_ROOT" "$pattern")
		((any)) || echo "  -           $pattern (no source yet)"
	done < <(map_patterns)
	local file
	if file=$(exclude_file) && grep -qxF "$EXCLUDE_BEGIN" "$file" 2>/dev/null; then
		echo "Git:     mapped paths are excluded in $file"
	else
		echo "Git:     no exclude block yet (task crm:link writes it)"
	fi
	echo "Registration:"
	"$CRM_PHP" "$REPO/dev/crm-info.php" "$CRM_ROOT" "$MODULE" || warn "cannot read the stand DB"
}

cmd_smoke() {
	check_crm
	[[ -f $CRM_ROOT/Taskfile.yml ]] || die "$CRM_ROOT has no Taskfile.yml with a smoke task"
	task -d "$CRM_ROOT" smoke
}

command=${1:-status}
shift || true
for arg in "$@"; do
	case $arg in
		--force) FORCE=1 ;;
		*) die "unknown option: $arg" ;;
	esac
done
[[ -f $MAP ]] || die "no $MAP"
case $command in
	link) cmd_link ;;
	unlink) cmd_unlink ;;
	status) cmd_status ;;
	smoke) cmd_smoke ;;
	*) die "usage: dev/crm-link.sh link [--force] | unlink | status | smoke" ;;
esac
