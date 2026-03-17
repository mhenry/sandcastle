#!/bin/bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER_NAME="${CLAUDE_SANDBOX_NAME:-claude-sandbox}"
IMAGE_NAME="claude-sandbox:local"

echo "=== Claude Sandbox Setup ==="
echo ""

# Check if container already exists
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Container '${CONTAINER_NAME}' already exists."
  echo "Run cleanup.sh first if you want to start fresh."
  exit 1
fi

# Prompt for CLAUDE_CODE_OAUTH_TOKEN
echo "We need a Claude Code OAuth token to authenticate Claude inside the sandbox."
echo ""
echo "To get your token, run this in your terminal:"
echo "  claude config get oauthToken"
echo ""
read -rp "Paste your CLAUDE_CODE_OAUTH_TOKEN: " CLAUDE_CODE_OAUTH_TOKEN

if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
  echo "Error: OAuth token is required."
  exit 1
fi

# Prompt for GH_TOKEN
echo ""
echo "We need a GitHub token so Claude can read/comment on issues."
echo ""
echo "Create a Personal Access Token (classic) at:"
echo "  https://github.com/settings/tokens"
echo ""
echo "Required scopes: repo (for private repos) or public_repo (for public repos)"
echo ""
read -rp "Paste your GH_TOKEN: " GH_TOKEN

if [ -z "$GH_TOKEN" ]; then
  echo "Error: GitHub token is required."
  exit 1
fi

# Build the Docker image
echo ""
echo "Building Docker image..."
docker build -t "$IMAGE_NAME" "$SCRIPT_DIR"

# Start the container
echo ""
echo "Starting container '${CONTAINER_NAME}'..."
docker run -d \
  --name "$CONTAINER_NAME" \
  -e "CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_CODE_OAUTH_TOKEN" \
  -e "GH_TOKEN=$GH_TOKEN" \
  "$IMAGE_NAME"

echo ""
echo "Setup complete! Container '${CONTAINER_NAME}' is running."
echo ""
echo "Next steps:"
echo "  cd into any git repo and run:"
echo "  ${SCRIPT_DIR}/run.sh <iterations>"
