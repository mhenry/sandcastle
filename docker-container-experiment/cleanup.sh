#!/bin/bash
set -eo pipefail

CONTAINER_NAME="${CLAUDE_SANDBOX_NAME:-claude-sandbox}"
IMAGE_NAME="claude-sandbox:local"

echo "=== Claude Sandbox Cleanup ==="

# Stop and remove container
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Stopping container '${CONTAINER_NAME}'..."
  docker stop "$CONTAINER_NAME" 2>/dev/null || true
  echo "Removing container '${CONTAINER_NAME}'..."
  docker rm "$CONTAINER_NAME"
else
  echo "Container '${CONTAINER_NAME}' not found."
fi

# Remove image
if docker images --format '{{.Repository}}:{{.Tag}}' | grep -q "^${IMAGE_NAME}$"; then
  echo "Removing image '${IMAGE_NAME}'..."
  docker rmi "$IMAGE_NAME"
else
  echo "Image '${IMAGE_NAME}' not found."
fi

echo ""
echo "Cleanup complete."
