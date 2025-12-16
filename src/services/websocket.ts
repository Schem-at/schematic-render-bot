import { logger } from "../shared/logger.js";
import { getMetricsStats, getActiveRenders, getRecentRenders } from "./metrics.js";
import { getPuppeteerMetrics } from "./puppeteer.js";
import { db } from "./database.js";

interface WebSocketClient {
	socket: WebSocket;
	id: string;
	lastPing: number;
}

const clients = new Map<string, WebSocketClient>();
let broadcastInterval: ReturnType<typeof setInterval> | null = null;
const UPDATE_INTERVAL = 2000; // 2 seconds

/**
 * Handle WebSocket upgrade request (for use with Bun.serve)
 */
export function handleWebSocketUpgrade(req: Request, server: any): Response | undefined {
	const url = new URL(req.url);

	if (url.pathname === "/ws/admin") {
		const success = server.upgrade(req, {
			data: {
				createdAt: Date.now(),
			},
		});

		if (success) {
			return undefined; // Upgrade successful, don't return a response
		}
	}

	// Return undefined to let Express handle the request
	return undefined;
}

/**
 * Handle new WebSocket connection (called by Bun.serve websocket handler)
 */
export function handleWebSocketOpen(ws: WebSocket, server: any): void {
	try {
		const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		const client: WebSocketClient = {
			socket: ws,
			id: clientId,
			lastPing: Date.now(),
		};

		clients.set(clientId, client);
		logger.info(`[WebSocket] Client connected: ${clientId} (${clients.size} total)`);
		logger.info(`[WebSocket] Connection readyState: ${ws.readyState}, protocol: ${ws.protocol}`);

		// Send initial data after a short delay to ensure connection is fully established
		setTimeout(async () => {
			try {
				// Check WebSocket state - OPEN is 1 in WebSocket API
				if (ws.readyState === 1 || ws.readyState === WebSocket.OPEN) {
					logger.info(`[WebSocket] Sending initial data to ${clientId}`);
					await sendUpdate(client);
				} else {
					logger.warn(`[WebSocket] Connection ${clientId} not ready, state: ${ws.readyState}`);
				}
			} catch (error) {
				logger.error(`[WebSocket] Error sending initial update to ${clientId}:`, error);
			}
		}, 100);
	} catch (error) {
		logger.error(`[WebSocket] Error in handleWebSocketOpen:`, error);
		// Don't close the connection on error, just log it
	}
}

/**
 * Handle WebSocket message
 */
export function handleWebSocketMessage(ws: WebSocket, message: string | Buffer): void {
	const client = Array.from(clients.values()).find((c) => c.socket === ws);
	if (!client) return;

	try {
		const data = JSON.parse(message.toString());
		if (data.type === "ping") {
			client.lastPing = Date.now();
			ws.send(JSON.stringify({ type: "pong" }));
		}
	} catch (error) {
		logger.warn(`[WebSocket] Error parsing message from ${client.id}:`, error);
	}
}

/**
 * Handle WebSocket close
 */
export function handleWebSocketClose(ws: WebSocket): void {
	const client = Array.from(clients.entries()).find(([_, c]) => c.socket === ws);
	if (client) {
		clients.delete(client[0]);
		logger.info(`[WebSocket] Client disconnected: ${client[0]} (${clients.size} total)`);
	}
}

/**
 * Handle WebSocket error
 */
export function handleWebSocketError(ws: WebSocket, error: Error): void {
	const client = Array.from(clients.entries()).find(([_, c]) => c.socket === ws);
	if (client) {
		logger.error(`[WebSocket] Error for client ${client[0]}:`, error);
		clients.delete(client[0]);
	}
}

/**
 * Initialize WebSocket service
 */
export function initWebSocketService(): void {
	// Start broadcasting updates
	if (!broadcastInterval) {
		broadcastInterval = setInterval(() => {
			broadcastUpdate();
		}, UPDATE_INTERVAL);
		logger.info("✅ WebSocket service initialized with broadcast interval");
	}
}

/**
 * Send update to a specific client
 */
async function sendUpdate(client: WebSocketClient): Promise<void> {
	try {
		const [metrics, activeRenders, renderHistory, analytics, puppeteerMetrics] = await Promise.all([
			fetchMetricsData(),
			fetchActiveRendersData(),
			fetchRenderHistoryData(),
			fetchAnalyticsData(),
			fetchPuppeteerMetricsData(),
		]);

		const update = {
			type: "update",
			data: {
				metrics,
				activeRenders,
				renderHistory,
				analytics,
				puppeteerMetrics,
				timestamp: Date.now(),
			},
		};

		// Check WebSocket state - OPEN is 1 in WebSocket API
		if (client.socket.readyState === 1 || client.socket.readyState === WebSocket.OPEN) {
			try {
				client.socket.send(JSON.stringify(update));
			} catch (sendError) {
				logger.error(`[WebSocket] Error sending to ${client.id}:`, sendError);
				// Remove client if send fails
				clients.delete(client.id);
			}
		} else {
			logger.warn(`[WebSocket] Client ${client.id} not ready, state: ${client.socket.readyState}`);
		}
	} catch (error) {
		logger.error(`[WebSocket] Error sending update to ${client.id}:`, error);
	}
}

/**
 * Broadcast update to all connected clients
 */
async function broadcastUpdate(): Promise<void> {
	if (clients.size === 0) return;

	try {
		const [metrics, activeRenders, renderHistory, analytics, puppeteerMetrics] = await Promise.all([
			fetchMetricsData(),
			fetchActiveRendersData(),
			fetchRenderHistoryData(),
			fetchAnalyticsData(),
			fetchPuppeteerMetricsData(),
		]);

		const update = {
			type: "update",
			data: {
				metrics,
				activeRenders,
				renderHistory,
				analytics,
				puppeteerMetrics,
				timestamp: Date.now(),
			},
		};

		const message = JSON.stringify(update);
		const disconnectedClients: string[] = [];

		for (const [clientId, client] of clients.entries()) {
			try {
				// Check WebSocket state - OPEN is 1 in WebSocket API
				if (client.socket.readyState === 1 || client.socket.readyState === WebSocket.OPEN) {
					client.socket.send(message);
				} else {
					logger.warn(`[WebSocket] Client ${clientId} not ready, state: ${client.socket.readyState}`);
					disconnectedClients.push(clientId);
				}
			} catch (error) {
				logger.warn(`[WebSocket] Error sending to ${clientId}:`, error);
				disconnectedClients.push(clientId);
			}
		}

		// Clean up disconnected clients
		for (const clientId of disconnectedClients) {
			clients.delete(clientId);
		}
	} catch (error) {
		logger.error("[WebSocket] Error broadcasting update:", error);
	}
}

/**
 * Fetch metrics data
 */
async function fetchMetricsData() {
	const renderMetrics = getMetricsStats();
	const { getBrowserStatus } = await import("./puppeteer.js");
	const browserStatus = getBrowserStatus();
	const os = await import("os");

	return {
		timestamp: Date.now(),
		renderMetrics,
		browserStatus,
		systemMetrics: {
			memory: {
				total: Math.round(os.totalmem() / 1024 / 1024),
				free: Math.round(os.freemem() / 1024 / 1024),
				used: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024),
				usagePercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
			},
			cpu: {
				cores: os.cpus().length,
				model: os.cpus()[0]?.model || "Unknown",
				loadAvg: os.loadavg(),
			},
			uptime: Math.round(process.uptime()),
			platform: process.platform,
			nodeVersion: process.version,
		},
	};
}

/**
 * Fetch active renders data
 */
function fetchActiveRendersData() {
	return { activeRenders: getActiveRenders() };
}

/**
 * Fetch render history data
 */
function fetchRenderHistoryData() {
	return { renders: getRecentRenders(20) };
}

/**
 * Fetch analytics data
 */
async function fetchAnalyticsData() {
	try {
		const hours = 24;
		const since = Date.now() - hours * 60 * 60 * 1000;

		const timeline = db
			.prepare(
				`
      SELECT 
        strftime('%H:00', datetime(start_time / 1000, 'unixepoch', 'localtime')) as hour,
        COUNT(*) as renders,
        AVG(CASE WHEN status = 'completed' THEN duration ELSE NULL END) as avgDuration
      FROM renders
      WHERE start_time >= ?
      GROUP BY hour
      ORDER BY hour ASC
    `
			)
			.all(since);

		const normalizedTimeline = (timeline || []).map((item: any) => ({
			...item,
			renders: Number(item.renders) || 0,
			avgDuration: item.avgDuration ? Math.round(Number(item.avgDuration)) : 0,
		}));

		const perf = db
			.prepare(
				`
      SELECT 
        AVG(duration) as avgDuration,
        MIN(duration) as fastest,
        MAX(duration) as slowest
      FROM renders
      WHERE status = 'completed' AND duration IS NOT NULL
    `
			)
			.get() as any;

		const durations = db
			.prepare(
				`
      SELECT duration FROM renders 
      WHERE status = 'completed' AND duration IS NOT NULL 
      ORDER BY duration ASC
    `
			)
			.all() as Array<{ duration: number }>;

		const p50 = durations[Math.floor(durations.length * 0.5)]?.duration || 0;
		const p95 = durations[Math.floor(durations.length * 0.95)]?.duration || 0;
		const p99 = durations[Math.floor(durations.length * 0.99)]?.duration || 0;

		const byType = db
			.prepare(
				`
      SELECT type, COUNT(*) as count, AVG(duration) as avg_duration
      FROM renders
      WHERE status = 'completed'
      GROUP BY type
    `
			)
			.all();

		const byStatus = db
			.prepare(
				`
      SELECT status, COUNT(*) as count
      FROM renders
      GROUP BY status
    `
			)
			.all();

		const outliers = db
			.prepare(
				`
      SELECT 
        r.id, 
        r.duration as duration_ms,
        r.file_size as file_size_bytes,
        (SELECT file_hash FROM artifacts WHERE render_id = r.id AND type = 'thumbnail' LIMIT 1) as thumbnail_hash
      FROM renders r
      WHERE r.status = 'completed' AND r.duration IS NOT NULL
      ORDER BY r.duration DESC
      LIMIT 12
    `
			)
			.all();

		return {
			timeline: normalizedTimeline,
			performance: {
				avgDuration: perf?.avgDuration || 0,
				p50,
				p95,
				p99,
				fastest: perf?.fastest || 0,
				slowest: perf?.slowest || 0,
			},
			distribution: {
				byType: byType || [],
				byStatus: byStatus || [],
			},
			outliers: outliers || [],
			topFiles: [],
		};
	} catch (error) {
		logger.error("Error fetching analytics:", error);
		return {
			timeline: [],
			performance: {
				avgDuration: 0,
				p50: 0,
				p95: 0,
				p99: 0,
				fastest: 0,
				slowest: 0,
			},
			distribution: {
				byType: [],
				byStatus: [],
			},
			outliers: [],
			topFiles: [],
		};
	}
}

/**
 * Fetch Puppeteer metrics data
 */
async function fetchPuppeteerMetricsData() {
	try {
		return await getPuppeteerMetrics();
	} catch (error) {
		logger.error("Error fetching Puppeteer metrics:", error);
		return null;
	}
}

/**
 * Cleanup WebSocket service
 */
export function cleanupWebSocketService(): void {
	if (broadcastInterval) {
		clearInterval(broadcastInterval);
		broadcastInterval = null;
	}
	clients.clear();
	logger.info("WebSocket service cleaned up");
}
