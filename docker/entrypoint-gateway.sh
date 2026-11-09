#!/bin/sh
# Start both processes and exit the container if either one dies.

: "${ROUTER_PASSWORD:?ROUTER_PASSWORD must be set to a non-empty password}"

cleanup() {
    kill "$ROUTER_PID" "$CADDY_PID" 2>/dev/null
    wait "$ROUTER_PID" "$CADDY_PID" 2>/dev/null
    exit 1
}

trap cleanup TERM INT

opencodeui-router &
ROUTER_PID=$!

caddy run --config /etc/caddy/Caddyfile &
CADDY_PID=$!

# Wait for either process to exit, then tear down the other.
# `wait -n` is not available in busybox sh, so poll both.
while kill -0 "$ROUTER_PID" 2>/dev/null && kill -0 "$CADDY_PID" 2>/dev/null; do
    wait -n "$ROUTER_PID" "$CADDY_PID" 2>/dev/null || sleep 1
done

echo "One of the processes exited, shutting down..."
cleanup
