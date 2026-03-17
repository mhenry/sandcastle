#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

require_container
detect_repo

echo "=== RALPH (Interactive) ==="
echo "Repo:   ${REPO_FULL}"
echo "Branch: ${BRANCH}"
echo ""

echo "Syncing repo into sandbox..."
sync_to_sandbox

echo ""
echo "Launching interactive Claude session..."
echo ""

docker exec -it -w "$SANDBOX_REPO_DIR" "$CONTAINER_NAME" \
  claude \
    --dangerously-skip-permissions \
    --model claude-opus-4-6

echo ""
echo "Session ended. Syncing changes back..."
sync_from_sandbox
