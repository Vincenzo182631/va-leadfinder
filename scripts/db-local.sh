#!/usr/bin/env bash
# Local Postgres 16 for development/tests (no Docker needed).
# Applies the Supabase shim, all migrations and reference seed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DATA="$ROOT/.local/pg"
PORT="${LOCAL_PG_PORT:-54329}"
DB="${LOCAL_PG_DB:-vlf}"
export PATH="$PGBIN:$PATH"
RUNAS=()
if [ "$(id -u)" = "0" ]; then RUNAS=(runuser -u postgres --); fi

psql_db() { "${RUNAS[@]}" psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

start() {
  mkdir -p "$ROOT/.local"
  if [ ! -d "$DATA" ]; then
    mkdir -p "$DATA"; [ "${#RUNAS[@]}" -gt 0 ] && chown -R postgres "$ROOT/.local"
    "${RUNAS[@]}" initdb -D "$DATA" -U postgres --auth=trust >/dev/null
  fi
  if ! "${RUNAS[@]}" pg_ctl -D "$DATA" status >/dev/null 2>&1; then
    "${RUNAS[@]}" pg_ctl -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -l "$ROOT/.local/pg.log" -w start >/dev/null
  fi
  echo "postgres running on 127.0.0.1:$PORT"
}

migrate() {
  local db="$1"
  psql_db -d "$db" -f "$ROOT/supabase/local/000_supabase_shim.sql"
  for f in "$ROOT"/supabase/migrations/*.sql; do psql_db -d "$db" -f "$f"; done
  psql_db -d "$db" -f "$ROOT/supabase/seed/seed.sql"
}

reset() {
  start
  local db="${1:-$DB}"
  psql_db -d postgres -c "drop database if exists $db with (force)" -c "create database $db"
  migrate "$db"
  echo "database $db reset and migrated"
}

case "${1:-start}" in
  start) start ;;
  stop) "${RUNAS[@]}" pg_ctl -D "$DATA" stop >/dev/null && echo stopped ;;
  reset) reset "${2:-$DB}" ;;
  *) echo "usage: db-local.sh start|stop|reset [db]"; exit 1 ;;
esac
