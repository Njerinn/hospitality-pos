#!/usr/bin/env bash
set -euo pipefail

PGDATA="${PREFIX:-/usr}/var/lib/postgresql"
PGLOG="${PREFIX:-/usr}/var/log/postgres.log"
PGPORT="${PGPORT:-5432}"
REDIS_PORT="${REDIS_PORT:-6379}"
PG_SUPERUSER="$(whoami)"

require_bin() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: $1 not found. Install with: pkg install postgresql redis" >&2
    exit 1
  }
}

ensure_pg_cluster() {
  mkdir -p "$PGDATA" "$(dirname "$PGLOG")"
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "▶ initializing PostgreSQL cluster at $PGDATA"
    initdb "$PGDATA" >/dev/null
  fi
}

pg_running() {
  pg_ctl -D "$PGDATA" status >/dev/null 2>&1
}

psql_admin() {
  psql -h 127.0.0.1 -p "$PGPORT" -U "$PG_SUPERUSER" -d postgres "$@"
}

start_pg() {
  if pg_running; then
    echo "▶ PostgreSQL already running"
    return
  fi
  echo "▶ starting PostgreSQL on port $PGPORT"
  pg_ctl -D "$PGDATA" -l "$PGLOG" -o "-p $PGPORT" start >/dev/null
  for _ in $(seq 1 30); do
    psql_admin -c "SELECT 1" >/dev/null 2>&1 && return
    sleep 1
  done
  echo "❌ PostgreSQL did not become ready (see $PGLOG)" >&2
  exit 1
}

ensure_role_and_db() {
  if ! psql_admin -tAc "SELECT 1 FROM pg_roles WHERE rolname='pos'" | grep -q 1; then
    psql_admin -c "CREATE ROLE pos LOGIN PASSWORD 'pos';" >/dev/null
    echo "▶ created role 'pos'"
  fi
  if ! psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname='pos'" | grep -q 1; then
    psql_admin -c "CREATE DATABASE pos OWNER pos;" >/dev/null
    echo "▶ created database 'pos'"
  fi
}

start_redis() {
  if redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
    echo "▶ Redis already running"
    return
  fi
  echo "▶ starting Redis on port $REDIS_PORT"
  redis-server --daemonize yes --port "$REDIS_PORT"
  for _ in $(seq 1 10); do
    redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1 && return
    sleep 1
  done
  echo "❌ Redis did not start" >&2
  exit 1
}

stop_pg() {
  if pg_running; then
    echo "▶ stopping PostgreSQL"
    pg_ctl -D "$PGDATA" -m fast stop >/dev/null
  else
    echo "▶ PostgreSQL not running"
  fi
}

stop_redis() {
  if redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
    echo "▶ stopping Redis"
    redis-cli -p "$REDIS_PORT" shutdown nosave >/dev/null || true
  else
    echo "▶ Redis not running"
  fi
}

case "${1:-up}" in
  up)
    require_bin pg_ctl
    require_bin initdb
    require_bin psql
    require_bin redis-server
    ensure_pg_cluster
    start_pg
    ensure_role_and_db
    start_redis
    echo "✅ dev stack up — PG:127.0.0.1:$PGPORT (db=pos user=pos) Redis:127.0.0.1:$REDIS_PORT"
    ;;
  down)
    stop_pg
    stop_redis
    echo "✅ dev stack down"
    ;;
  status)
    pg_ctl -D "$PGDATA" status 2>&1 || true
    redis-cli -p "$REDIS_PORT" ping 2>&1 || true
    ;;
  reset)
    stop_pg
    stop_redis
    rm -rf "$PGDATA"
    echo "▶ cluster wiped"
    exec "$0" up
    ;;
  *)
    echo "usage: $0 {up|down|status|reset}" >&2
    exit 2
    ;;
esac
