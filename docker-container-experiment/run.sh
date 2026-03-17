#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# --- Validation ---

if [ -z "$1" ]; then
  echo "Usage: $0 <iterations>"
  exit 1
fi

ITERATIONS="$1"

require_container
detect_repo

echo "=== RALPH ==="
echo "Repo:       ${REPO_FULL}"
echo "Branch:     ${BRANCH}"
echo "Iterations: ${ITERATIONS}"
echo ""

# --- Load prompt from file ---

PROMPT_FILE="${SCRIPT_DIR}/prompt.md"

if [ ! -f "$PROMPT_FILE" ]; then
  echo "Error: Prompt file not found at ${PROMPT_FILE}"
  exit 1
fi

PROMPT=$(cat "$PROMPT_FILE")

# --- jq filters ---

stream_text='select(.type == "assistant").message.content[]? | select(.type == "text").text // empty | gsub("\n"; "\r\n") | . + "\r\n\n"'
final_result='select(.type == "result").result // empty'

# --- Main loop ---

echo "Syncing repo into sandbox..."
sync_to_sandbox

for ((i=1; i<=ITERATIONS; i++)); do
  echo ""
  echo "=== Iteration ${i}/${ITERATIONS} ==="
  echo ""

  tmpfile=$(mktemp)

  # Record HEAD before Claude runs
  head_before=$(get_sandbox_head)

  # Fetch context inside sandbox
  issues=$(docker exec -w "$SANDBOX_REPO_DIR" "$CONTAINER_NAME" \
    gh issue list --repo "$REPO_FULL" --state open --json number,title,body,comments 2>/dev/null || echo "[]")

  ralph_commits=$(docker exec -w "$SANDBOX_REPO_DIR" "$CONTAINER_NAME" \
    git log --grep="RALPH" -n 10 --format="%H%n%ad%n%B---" --date=short 2>/dev/null || echo "No RALPH commits found")

  # Run Claude inside sandbox
  docker exec -w "$SANDBOX_REPO_DIR" "$CONTAINER_NAME" \
    claude \
      --print \
      --verbose \
      --dangerously-skip-permissions \
      --output-format stream-json \
      --model claude-opus-4-6 \
      -p "ISSUES: ${issues}

Previous RALPH commits: ${ralph_commits}

${PROMPT}" \
  | grep --line-buffered '^{' \
  | tee "$tmpfile" \
  | jq --unbuffered -rj "$stream_text"

  # Check if Claude made a commit
  head_after=$(get_sandbox_head)

  if [ "$head_before" != "$head_after" ]; then
    echo ""
    echo "New commit detected. Extracting patch..."
    sync_commits_from_sandbox "$head_before"
  else
    echo ""
    echo "No new commit in this iteration."
  fi

  # Check for completion signal (after patch extraction)
  result=$(jq -r "$final_result" "$tmpfile")
  rm -f "$tmpfile"

  if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
    echo ""
    echo "RALPH complete after ${i} iteration(s)."
    exit 0
  fi

  # Re-sync sandbox for next iteration
  echo "Re-syncing sandbox to match local state..."
  sync_to_sandbox
done

echo ""
echo "Completed ${ITERATIONS} iteration(s)."
