#!/bin/sh
set -e

OLLAMA_URL="${OLLAMA_BASE_URL:-http://ollama:11434}"
TARGET_MODEL="${OLLAMA_MODEL:-gemma4:cloud}"

echo "🔍 Verifying Ollama API connectivity at ${OLLAMA_URL}..."

# Wait for Ollama service to respond
MAX_RETRIES=15
RETRY_COUNT=0
until curl -s -f "${OLLAMA_URL}/api/tags" > /dev/null 2>&1 || [ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]; do
  echo "⏳ Waiting for Ollama API to be ready ($((RETRY_COUNT+1))/${MAX_RETRIES})..."
  RETRY_COUNT=$((RETRY_COUNT+1))
  sleep 2
done

# Query Ollama API for installed models
TAGS_OUTPUT=$(curl -s "${OLLAMA_URL}/api/tags" || true)

if echo "$TAGS_OUTPUT" | grep -q "\"${TARGET_MODEL}\""; then
  echo "✅ Model '${TARGET_MODEL}' is ready in local catalog."
else
  echo "⬇️ Model '${TARGET_MODEL}' not found. Initiating pull..."
  curl -s -X POST "${OLLAMA_URL}/api/pull" \
       -H "Content-Type: application/json" \
       -d "{\"name\": \"${TARGET_MODEL}\", \"stream\": false}"
  echo "✅ Model pull completed."
fi

echo "🚀 Starting Crypto Agent server on port ${PORT:-3001}..."
exec node dist/server.js
