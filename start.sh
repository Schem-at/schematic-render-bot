#!/bin/bash

# Start script with proper initialization order

PORT=${PORT:-3000}

echo "🚀 Starting Schemat Render Service on port ${PORT}..."

# Start the backend and wait for it to be fully ready
echo "📱 Starting backend server..."
node dist/app.js &
BACKEND_PID=$!

# Wait for backend to be ready
echo "⏳ Waiting for backend to initialize..."
while ! curl -f http://localhost:${PORT}/health >/dev/null 2>&1; do
  sleep 1
done

echo "✅ Backend ready!"

# Give extra time for full initialization
sleep 5

echo "🌐 Frontend should now be accessible at http://localhost:${PORT}"

# Keep the backend running
wait $BACKEND_PID