#!/bin/bash
# Shared functions and setup for docker sandbox scripts.
# Source this file from run.sh and interactive.sh.

set -eo pipefail

CONTAINER_NAME="${CLAUDE_SANDBOX_NAME:-claude-sandbox}"
REPOS_DIR="/home/agent/repos"

# --- Container validation ---

require_container() {
  if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
      echo "Container '${CONTAINER_NAME}' exists but is not running. Starting it..."
      docker start "${CONTAINER_NAME}"
    else
      echo "Error: Container '${CONTAINER_NAME}' does not exist."
      echo "Run setup.sh first."
      exit 1
    fi
  fi
}

# --- Repo detection ---

detect_repo() {
  if ! REPO_FULL=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null); then
    echo "Error: Not in a GitHub repo, or gh CLI not authenticated."
    exit 1
  fi

  REPO_NAME=$(basename "$REPO_FULL")
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  SANDBOX_REPO_DIR="${REPOS_DIR}/${REPO_NAME}"
}

# --- Sync local repo into sandbox via git bundle ---

sync_to_sandbox() {
  local bundle_host
  bundle_host=$(mktemp --suffix=.bundle)

  git bundle create "$bundle_host" --all

  docker cp "$bundle_host" "${CONTAINER_NAME}:/tmp/repo.bundle"
  rm -f "$bundle_host"

  if docker exec "$CONTAINER_NAME" test -d "$SANDBOX_REPO_DIR/.git"; then
    # Reset to match host: fetch bundle, hard reset, clean untracked files
    docker exec -w "$SANDBOX_REPO_DIR" "$CONTAINER_NAME" \
      git fetch /tmp/repo.bundle "${BRANCH}:refs/ralph/sync" --force
    docker exec -w "$SANDBOX_REPO_DIR" "$CONTAINER_NAME" \
      git checkout -f "$BRANCH"
    docker exec -w "$SANDBOX_REPO_DIR" "$CONTAINER_NAME" \
      git reset --hard refs/ralph/sync
    docker exec -w "$SANDBOX_REPO_DIR" "$CONTAINER_NAME" \
      git clean -fdx -e node_modules
  else
    docker exec "$CONTAINER_NAME" \
      git clone /tmp/repo.bundle "$SANDBOX_REPO_DIR"
    docker exec -w "$SANDBOX_REPO_DIR" "$CONTAINER_NAME" \
      git checkout "$BRANCH"
  fi

  # Point origin to the real GitHub remote
  docker exec -w "$SANDBOX_REPO_DIR" "$CONTAINER_NAME" \
    git remote set-url origin "https://github.com/${REPO_FULL}.git"

  # Install dependencies if a package.json exists
  if docker exec "$CONTAINER_NAME" test -f "$SANDBOX_REPO_DIR/package.json"; then
    echo "Installing dependencies..."
    docker exec -w "$SANDBOX_REPO_DIR" "$CONTAINER_NAME" npm install
  fi

  docker exec -u root "$CONTAINER_NAME" rm -f /tmp/repo.bundle

  # Verify sync succeeded
  local local_head sandbox_head
  local_head=$(git rev-parse HEAD)
  sandbox_head=$(docker exec -w "$SANDBOX_REPO_DIR" "$CONTAINER_NAME" git rev-parse HEAD 2>/dev/null)

  if [ "$local_head" != "$sandbox_head" ]; then
    echo "ERROR: Sandbox HEAD ($sandbox_head) does not match local HEAD ($local_head)"
    exit 1
  fi

  # Verify working tree is clean
  local dirty
  dirty=$(docker exec -w "$SANDBOX_REPO_DIR" "$CONTAINER_NAME" git status --porcelain 2>/dev/null)
  if [ -n "$dirty" ]; then
    echo "WARNING: Sandbox has uncommitted changes after sync:"
    echo "$dirty"
  fi
}

# --- Get sandbox HEAD ---

get_sandbox_head() {
  docker exec -w "$SANDBOX_REPO_DIR" "$CONTAINER_NAME" \
    git rev-parse HEAD 2>/dev/null
}

# --- Sync commits from sandbox back to host ---

# Usage: sync_commits_from_sandbox [base_sha]
# base_sha: the sandbox HEAD before Claude ran (defaults to local HEAD)
sync_commits_from_sandbox() {
  local base_head="${1:-$(git rev-parse HEAD)}"

  local sandbox_head
  sandbox_head=$(get_sandbox_head)

  if [ "$base_head" = "$sandbox_head" ]; then
    echo "No new commits to sync."
    return
  fi

  local new_commit_count
  new_commit_count=$(docker exec -w "$SANDBOX_REPO_DIR" "$CONTAINER_NAME" \
    git rev-list "${base_head}..HEAD" --count 2>/dev/null)

  if [ -z "$new_commit_count" ] || [ "$new_commit_count" = "0" ]; then
    echo "ERROR: Sandbox HEAD ($sandbox_head) differs from base ($base_head) but no commits found in range."
    echo "This likely means the commit histories have diverged."
    return 1
  fi

  echo "Found ${new_commit_count} new commit(s). Extracting patches..."

  local patch_dir
  patch_dir=$(mktemp -d)

  # Clean any leftover patches from previous runs
  docker exec -u root "$CONTAINER_NAME" rm -rf /tmp/patches

  docker exec -w "$SANDBOX_REPO_DIR" "$CONTAINER_NAME" \
    git format-patch "${base_head}..HEAD" -o /tmp/patches 2>/dev/null

  docker cp "${CONTAINER_NAME}:/tmp/patches/." "$patch_dir/"

  # Abort any leftover git am session
  git am --abort 2>/dev/null || true

  local patch_count=0
  for patch_file in "$patch_dir"/*.patch; do
    [ -f "$patch_file" ] || continue
    git am --3way "$patch_file"
    patch_count=$((patch_count + 1))
  done

  rm -rf "$patch_dir"
  docker exec -u root "$CONTAINER_NAME" rm -rf /tmp/patches

  echo "Applied ${patch_count} patch(es) locally."
}

# --- Sync uncommitted changes from sandbox back to host ---

sync_uncommitted_from_sandbox() {
  local has_changes=false

  # Staged + unstaged changes
  local diff
  diff=$(docker exec -w "$SANDBOX_REPO_DIR" "$CONTAINER_NAME" \
    git diff HEAD 2>/dev/null || true)

  if [ -n "$diff" ]; then
    has_changes=true
    local diff_file
    diff_file=$(mktemp --suffix=.patch)

    docker exec -w "$SANDBOX_REPO_DIR" "$CONTAINER_NAME" \
      git diff HEAD > "$diff_file"

    git apply "$diff_file"
    rm -f "$diff_file"
    echo "Applied uncommitted changes."
  fi

  # Untracked files
  local untracked
  untracked=$(docker exec -w "$SANDBOX_REPO_DIR" "$CONTAINER_NAME" \
    git ls-files --others --exclude-standard 2>/dev/null || true)

  if [ -n "$untracked" ]; then
    has_changes=true
    local untracked_dir
    untracked_dir=$(mktemp -d)

    while IFS= read -r file; do
      [ -z "$file" ] && continue
      local dir
      dir=$(dirname "$file")
      mkdir -p "$untracked_dir/$dir"
      docker cp "${CONTAINER_NAME}:${SANDBOX_REPO_DIR}/${file}" "$untracked_dir/$file"
    done <<< "$untracked"

    while IFS= read -r file; do
      [ -z "$file" ] && continue
      local dir
      dir=$(dirname "$file")
      mkdir -p "$dir"
      cp "$untracked_dir/$file" "$file"
    done <<< "$untracked"

    rm -rf "$untracked_dir"
    echo "Copied $(echo "$untracked" | wc -l | tr -d ' ') untracked file(s)."
  fi

  if [ "$has_changes" = false ]; then
    echo "No uncommitted changes to sync."
  fi
}

# --- Sync everything from sandbox back to host ---

sync_from_sandbox() {
  sync_commits_from_sandbox
  sync_uncommitted_from_sandbox
}
