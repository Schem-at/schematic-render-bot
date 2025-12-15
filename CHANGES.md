# Recent Changes - Isolated Browser Architecture & Admin Dashboard

## Overview
This update introduces a new isolated browser architecture for better performance and resource management, along with a comprehensive admin dashboard for monitoring.

## Key Changes

### 1. Isolated Browser Architecture
**Previous Behavior:**
- Single shared browser instance with page pool
- Pages reused across multiple render tasks
- Potential memory leaks and performance degradation over time

**New Behavior:**
- Each render task gets a fresh browser instance
- Browser instances are automatically closed after rendering
- Better isolation and memory management
- Reduced cross-request interference

**Files Modified:**
- `src/services/puppeteer.ts` - Refactored to create isolated browsers
- `src/services/renderer.ts` - Updated to use isolated browser instances

**Key Functions:**
```typescript
// Create a new isolated browser for each render
createIsolatedBrowser() -> { browser, page, id }

// Clean up after render completes
closeIsolatedBrowser(browserId)

// Monitor active browsers
getBrowserStatus()
```

### 2. Metrics Tracking System
**New Service:** `src/services/metrics.ts`

Tracks comprehensive render metrics including:
- Total renders (successful/failed)
- Success rate
- Average processing time
- Active renders (real-time)
- Render history (last 100 renders)
- Per-render details (meshes, duration, file size)

**Key Functions:**
```typescript
trackRenderStart(id, type, fileSize)
trackRenderComplete(id, duration, meshCount)
trackRenderError(id, error)
getMetricsStats()
getActiveRenders()
getRecentRenders(limit)
```

### 3. Admin Dashboard

#### Backend API Routes
**New Route:** `src/api/routes/admin.ts`

Endpoints:
- `GET /api/admin/metrics` - System and render metrics
- `GET /api/admin/active-renders` - Currently running renders
- `GET /api/admin/render-history?limit=N` - Recent render history
- `POST /api/admin/reset-metrics` - Reset all metrics
- `GET /api/admin/health` - Health check

#### Frontend Dashboard
**New Component:** `frontend/src/AdminDashboard.tsx`

Features:
- Real-time metrics (auto-refresh every 2s)
- System information (CPU, memory, uptime)
- Active renders monitoring
- Render history table
- Success rate tracking
- Average processing time
- Visual status indicators

**Access URL:** `http://localhost:3000/admin`

### 4. Routing System
**Modified:** `frontend/src/main.tsx`

Simple routing based on pathname:
- `/` - Main schematic renderer
- `/admin` - Admin dashboard

## Benefits

### Performance
- ✅ Fresh browser per render eliminates memory leaks
- ✅ Better resource isolation
- ✅ No cross-request contamination
- ✅ Automatic cleanup after each render

### Monitoring
- ✅ Real-time visibility into system health
- ✅ Track render success/failure rates
- ✅ Identify performance bottlenecks
- ✅ Monitor active renders
- ✅ System resource usage tracking

### Maintainability
- ✅ Clear separation of concerns
- ✅ Better error tracking and debugging
- ✅ Comprehensive logging with browser IDs
- ✅ Easy to scale and optimize

## Usage

### Running the Service
```bash
# Build and start
bun run build
bun run dev

# Production
bun start
```

### Accessing the Admin Dashboard
1. Navigate to `http://localhost:3000/admin`
2. View real-time metrics and system health
3. Monitor active renders
4. Check render history
5. Reset metrics if needed

### API Examples

**Get Metrics:**
```bash
curl http://localhost:3000/api/admin/metrics
```

**Get Active Renders:**
```bash
curl http://localhost:3000/api/admin/active-renders
```

**Reset Metrics:**
```bash
curl -X POST http://localhost:3000/api/admin/reset-metrics
```

## Logging

All logs now include browser IDs for better traceability:
```
[browser-1734298800000-abc123] Creating new isolated browser instance...
[browser-1734298800000-abc123] ✅ Isolated browser ready and initialized
[browser-1734298800000-abc123] Rendering schematic, size: 1234567 bytes
[browser-1734298800000-abc123] Closing isolated browser (lived 5432ms)
```

## Configuration

Environment variables remain unchanged:
- `PORT` - Server port (default: 3000)
- `MAX_CONCURRENT_RENDERS` - No longer used (kept for backwards compatibility)
- `DISCORD_TOKEN` - Optional Discord bot token

## Migration Notes

No breaking changes - the API interface remains the same:
- `POST /api/render-schematic` - Still works as before
- `POST /api/synthase/*` - Still works as before

The only change is internal architecture for better performance.

## Future Improvements

Potential enhancements:
- [ ] Add browser instance pooling with max lifetime
- [ ] Implement rate limiting per IP
- [ ] Add Prometheus metrics export
- [ ] WebSocket support for real-time dashboard updates
- [ ] Historical metrics persistence
- [ ] Alert system for failures
- [ ] Resource usage graphs

