#!/bin/sh
# Install root-owned, mode 0700, and invoke from a root systemd timer.
set -eu
umask 077
backup_dir=/var/backups/dokitruyen
mkdir -p "$backup_dir"
backup_file="$backup_dir/postgres-$(date -u +%Y%m%dT%H%M%SZ).dump"
runuser -u postgres -- pg_dump --format=custom --no-owner --no-acl dokitruyen > "$backup_file"
pg_restore --list "$backup_file" >/dev/null
printf 'Database backup verified: %s\n' "$backup_file"
