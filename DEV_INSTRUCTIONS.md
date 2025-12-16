# Developer Experience Improvements

## Hot Reloading is Now Enabled! 🔥

### What Changed

1. **Backend now proxies to Vite dev server** in development mode
2. **No more manual builds** during development
3. **Instant frontend updates** with Vite HMR
4. **Single port access**: Everything on `http://localhost:3000`

### How to Use

```bash
# Start dev servers (frontend on :5173, backend on :3000)
bun run dev

# Access the app at http://localhost:3000
# - Backend proxies to Vite dev server automatically
# - Hot reload works instantly
# - API routes work on same port
```

### What This Fixes

**Before:**

- ❌ Had to run `bun run build:frontend` after every change
- ❌ Had to manually copy to `dist-frontend`
- ❌ No hot reloading
- ❌ Slow feedback loop

**After:**

- ✅ Edit frontend files → See changes instantly
- ✅ No manual builds needed
- ✅ Vite HMR works perfectly
- ✅ Fast iteration

### How It Works

- **Development** (`NODE_ENV=development`): Backend proxies to Vite on port 5173
- **Production** (`NODE_ENV=production`): Backend serves built files from `dist-frontend`

### Port Configuration

Default ports (can be changed in `.env`):

- Backend: `3000` (or `PORT` env var)
- Vite Dev Server: `5173` (or `VITE_PORT` env var)

### Troubleshooting

**If hot reload doesn't work:**

1. Make sure both servers are running:

   ```bash
   # You should see:
   # [0] frontend running on port 5173
   # [1] backend running on port 3000
   ```

2. Access via backend port (3000), not Vite port (5173):

   - ✅ `http://localhost:3000`
   - ❌ `http://localhost:5173`

3. Check terminal for proxy messages:
   ```
   🔥 Development mode: Proxying to Vite dev server on port 5173
   ```

**If you see 502 errors:**

- Vite dev server isn't running yet
- Wait a few seconds for it to start
- Check terminal for "Local: http://localhost:5173"

### Building for Production

```bash
# Build everything
bun run build

# Or build separately
bun run build:frontend  # Builds to dist-frontend
bun run build:backend   # Compiles TS to dist

# Run production build
bun run start
```
