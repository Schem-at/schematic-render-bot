# Quick Start - Fixed!

## What I Fixed

1. **Proxy error handling** - Better error messages if Vite isn't ready
2. **Vite config** - Added proper server settings for CORS and host
3. **Startup order** - Backend now waits 3 seconds for Vite to start
4. **Better logging** - Colored output to see which server is which

## Start Dev Servers

```bash
# Stop any running servers first
pkill -f "bun run dev"

# Start both servers
bun run dev
```

You should see:

```
[vite]  VITE v6.x.x ready in XXX ms
[vite]  ➜  Local:   http://localhost:5173/
[backend] 🔥 Development mode: Proxying to Vite dev server on port 5173
[backend] 🌐 Server running on port 3000
```

## Access the App

**Go to:** http://localhost:3000

- ✅ Hot reload will work
- ✅ API routes work (`/api/*`)
- ✅ Frontend proxied from Vite

## If You See "Waiting for Vite dev server..."

This means:

- Backend started before Vite was ready
- Wait a few seconds and refresh
- Page will auto-refresh when Vite is ready

## Troubleshooting

### Port Already in Use

```bash
# Kill everything on ports 3000 and 5173
lsof -ti:3000,5173 | xargs kill -9

# Then restart
bun run dev
```

### Still Getting 404s

1. Check both servers are running:

   ```bash
   lsof -i:5173  # Should show Vite
   lsof -i:3000  # Should show backend
   ```

2. Access Vite directly to verify it works:

   - http://localhost:5173 - Should work
   - If this doesn't work, Vite isn't starting properly

3. Check for errors in terminal output

### Hot Reload Not Working

- Make sure you're accessing via `:3000` not `:5173`
- Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
- Check browser console for WebSocket connection errors
