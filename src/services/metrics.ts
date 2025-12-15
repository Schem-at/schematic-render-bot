import { logger } from "../shared/logger.js";

export interface RenderMetric {
	id: string;
	type: 'image' | 'video';
	status: 'running' | 'completed' | 'error';
	startTime: number;
	endTime?: number;
	duration?: number;
	fileSize: number;
	meshCount?: number;
	error?: string;
}

// In-memory metrics store (last 100 renders)
const MAX_METRICS = 100;
const metrics: Map<string, RenderMetric> = new Map();
const metricsHistory: RenderMetric[] = [];

// Statistics
let totalRenders = 0;
let successfulRenders = 0;
let failedRenders = 0;
let totalProcessingTime = 0;

export function trackRenderStart(id: string, type: 'image' | 'video', fileSize: number): void {
	const metric: RenderMetric = {
		id,
		type,
		status: 'running',
		startTime: Date.now(),
		fileSize,
	};
	
	metrics.set(id, metric);
	totalRenders++;
	
	logger.info(`[METRICS] Render started: ${id} (${type})`);
}

export function trackRenderComplete(id: string, duration: number, meshCount: number): void {
	const metric = metrics.get(id);
	if (!metric) {
		logger.warn(`[METRICS] Metric not found for render: ${id}`);
		return;
	}
	
	metric.status = 'completed';
	metric.endTime = Date.now();
	metric.duration = duration;
	metric.meshCount = meshCount;
	
	successfulRenders++;
	totalProcessingTime += duration;
	
	// Move to history
	metricsHistory.unshift(metric);
	if (metricsHistory.length > MAX_METRICS) {
		metricsHistory.pop();
	}
	metrics.delete(id);
	
	logger.info(`[METRICS] Render completed: ${id} in ${duration}ms (${meshCount} meshes)`);
}

export function trackRenderError(id: string, error: any): void {
	const metric = metrics.get(id);
	if (!metric) {
		logger.warn(`[METRICS] Metric not found for render: ${id}`);
		return;
	}
	
	metric.status = 'error';
	metric.endTime = Date.now();
	metric.duration = Date.now() - metric.startTime;
	metric.error = error.message || String(error);
	
	failedRenders++;
	
	// Move to history
	metricsHistory.unshift(metric);
	if (metricsHistory.length > MAX_METRICS) {
		metricsHistory.pop();
	}
	metrics.delete(id);
	
	logger.error(`[METRICS] Render failed: ${id} - ${metric.error}`);
}

export function getActiveRenders(): RenderMetric[] {
	return Array.from(metrics.values());
}

export function getRecentRenders(limit: number = 50): RenderMetric[] {
	return metricsHistory.slice(0, limit);
}

export function getMetricsStats() {
	const activeRenders = Array.from(metrics.values());
	const avgProcessingTime = successfulRenders > 0 ? totalProcessingTime / successfulRenders : 0;
	
	return {
		total: totalRenders,
		successful: successfulRenders,
		failed: failedRenders,
		successRate: totalRenders > 0 ? (successfulRenders / totalRenders) * 100 : 0,
		activeRenders: activeRenders.length,
		avgProcessingTime: Math.round(avgProcessingTime),
		recentRenders: metricsHistory.slice(0, 10),
	};
}

export function resetMetrics(): void {
	metrics.clear();
	metricsHistory.length = 0;
	totalRenders = 0;
	successfulRenders = 0;
	failedRenders = 0;
	totalProcessingTime = 0;
	logger.info('[METRICS] Metrics reset');
}

