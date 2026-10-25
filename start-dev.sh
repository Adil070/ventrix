#!/bin/bash
# ─────────────────────────────────────────────
# Ventrix — Kill & Start Dev Servers
# Uses tmux: each service gets its own window/tab
# ─────────────────────────────────────────────
ROOT="$(cd "$(dirname "$0")" && pwd)"

# Check tmux is available
if ! command -v tmux &>/dev/null; then
  echo "tmux is not installed. Run: sudo apt install tmux"
  exit 1
fi

echo "⏹  Killing any processes on ports 3000 and 4000..."
fuser -k 3000/tcp 2>/dev/null || true
fuser -k 4000/tcp 2>/dev/null || true
sleep 1

SESSION="ventrix"

# Kill old session if it exists
tmux kill-session -t "$SESSION" 2>/dev/null || true

echo "🚀 Launching tmux session with tabs..."

# Window 1: API
tmux new-session  -d -s "$SESSION" -n "API :4000"
tmux send-keys    -t "$SESSION:API :4000" "cd '$ROOT/apps/api' && npm run dev" Enter

# Window 2: Web
tmux new-window   -t "$SESSION" -n "Web :3000"
tmux send-keys    -t "$SESSION:Web :3000" "cd '$ROOT/apps/web' && npm run dev" Enter

# Start on the API tab
tmux select-window -t "$SESSION:API :4000"

echo ""
echo "✅ Services started in tmux session 'ventrix'"
echo "   API  → http://localhost:4000"
echo "   Docs → http://localhost:4000/api/docs"
echo "   Web  → http://localhost:3000"
echo ""
echo "   Attaching... (Ctrl+B then D to detach, Ctrl+B then 1/2 to switch tabs)"
echo ""

tmux attach-session -t "$SESSION"
