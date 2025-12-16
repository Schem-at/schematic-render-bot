import puppeteer, { Browser, Page } from "puppeteer";
import { logger } from "../shared/logger.js";

let isInitialized = false;
let initializationPromise: Promise<void> | null = null;
const PORT = parseInt(process.env.PORT || "3000");
const FRONTEND_URL = `http://localhost:${PORT}`;

// Track active browser instances for monitoring
const activeBrowsers = new Map<string, { browser: Browser; page: Page; startTime: number }>();

// tell TypeScript that window.schematicRendererInitialized, THREE, and window.schematicHelpers are defined

export async function initPuppeteerService(): Promise<void> {
	// Return existing initialization if already in progress
	if (initializationPromise) {
		return initializationPromise;
	}

	initializationPromise = (async () => {
		try {
			logger.info("🚀 Initializing Puppeteer service (isolated browser mode)...");

			// Test if React app is accessible
			const testBrowser = await puppeteer.launch({
				// @ts-ignore
				headless: "new",
				timeout: 60_000,
				args: [
					"--no-sandbox",
					"--disable-setuid-sandbox",
					"--disable-dev-shm-usage",
					"--disable-accelerated-2d-canvas",
					"--no-first-run",
					"--disable-audio-output",
					"--disable-background-timer-throttling",
					"--disable-backgrounding-occluded-windows",
					"--disable-renderer-backgrounding",
				],
			});

			const testPage = await testBrowser.newPage();
			await testPage.goto(FRONTEND_URL, {
				waitUntil: "domcontentloaded",
				timeout: 30000,
			});

			const title = await testPage.title();
			logger.info(`✅ React app accessible, title: ${title}`);

			await testPage.close();
			await testBrowser.close();

			isInitialized = true;
			logger.info("✅ Puppeteer service fully initialized (isolated browser mode)");
		} catch (error: any) {
			console.error("Failed to initialize Puppeteer:");
			console.error("Error message:", error.message);
			console.error("Error stack:", error.stack);
			console.error("Full error:", error);

			logger.error("Failed to initialize Puppeteer:", error.message || error);
			isInitialized = false;
			throw error;
		}
	})();

	return initializationPromise;
}

export interface BrowserRenderOptions {
	isometric?: boolean;
	background?: string;
}

/**
 * Create a new isolated browser instance with initialized page
 */
export async function createIsolatedBrowser(renderOptions?: BrowserRenderOptions): Promise<{ browser: Browser; page: Page; id: string }> {
	const browserId = `browser-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

	logger.info(`[${browserId}] Creating new isolated browser instance...`);

	const browser = await puppeteer.launch({
		// @ts-ignore
		headless: "new",
		timeout: 60_000,
		args: [
			"--no-sandbox",
			"--disable-setuid-sandbox",
			"--disable-dev-shm-usage",
			"--disable-accelerated-2d-canvas",
			"--no-first-run",
			"--disable-audio-output",
			"--disable-background-timer-throttling",
			"--disable-backgrounding-occluded-windows",
			"--disable-renderer-backgrounding",
		],
	});

	const page = await browser.newPage();

	// Enable logging for debugging
	page.on("console", (msg) => {
		const type = msg.type();
		const text = msg.text();
		logger.info(`[${browserId}] BROWSER [${type.toUpperCase()}]: ${text}`);
	});

	page.on("error", (err) => logger.error(`[${browserId}] PAGE ERROR:`, err));
	page.on("pageerror", (err) => logger.error(`[${browserId}] PAGE SCRIPT ERROR:`, err));

	// Set viewport for rendering
	await page.setViewport({ width: 1920, height: 1080 });

	try {
		// Build URL with render options as query parameters
		const url = new URL(FRONTEND_URL);
		if (renderOptions?.isometric !== undefined) {
			url.searchParams.set('isometric', renderOptions.isometric.toString());
		}
		if (renderOptions?.background) {
			url.searchParams.set('background', renderOptions.background);
		}

		const finalUrl = url.toString();
		logger.info(`[${browserId}] Loading React app: ${finalUrl}`);

		await page.goto(finalUrl, {
			waitUntil: "domcontentloaded",
			timeout: 30000,
		});

		logger.info(`[${browserId}] ✅ React app loaded successfully`);

		// Wait for the React app's global helpers to be ready
		await page.waitForFunction(
			() => {
				return (
					window.schematicHelpers &&
					typeof window.schematicHelpers.waitForReady === "function" &&
					typeof window.schematicHelpers.startVideoRecording === "function" &&
					typeof window.schematicHelpers.takeScreenshot === "function" &&
					typeof window.schematicHelpers.loadSchematic === "function"
				);
			},
			{
				timeout: 15000,
				polling: 500,
			}
		);

		logger.info(`[${browserId}] ✅ Schematic helpers found!`);

		// Check current status before waiting
		const preWaitStatus = await page.evaluate(() => {
			return {
				hasHelpers: !!window.schematicHelpers,
				isReady: window.schematicHelpers?.isReady(),
				rendererInitialized: window.schematicRendererInitialized,
			};
		});

		if (preWaitStatus.isReady) {
			logger.info(`[${browserId}] ✅ Renderer already ready, skipping wait`);
		} else {
			logger.info(`[${browserId}] Waiting for renderer initialization...`);

			// Wait for the renderer to be fully initialized
			await page.evaluate(() => {
				return new Promise((resolve, reject) => {
					const timeout = setTimeout(() => {
						reject(
							new Error("Renderer initialization timeout after 10 seconds")
						);
					}, 10000);

					window.schematicHelpers
						.waitForReady()
						.then(() => {
							clearTimeout(timeout);
							resolve(true);
						})
						.catch(reject);
				});
			});
		}

		// Track active browser
		activeBrowsers.set(browserId, { browser, page, startTime: Date.now() });

		logger.info(`[${browserId}] ✅ Isolated browser ready and initialized`);
		return { browser, page, id: browserId };
	} catch (error) {
		logger.error(`[${browserId}] ❌ Browser initialization failed:`, error);

		// Cleanup on error
		try {
			await page.close();
			await browser.close();
		} catch (cleanupError) {
			logger.error(`[${browserId}] Cleanup error:`, cleanupError);
		}

		throw error;
	}
}

/**
 * Close and cleanup isolated browser instance
 */
export async function closeIsolatedBrowser(browserId: string): Promise<void> {
	const browserInstance = activeBrowsers.get(browserId);
	if (!browserInstance) {
		logger.warn(`[${browserId}] Browser instance not found for cleanup`);
		return;
	}

	const duration = Date.now() - browserInstance.startTime;
	logger.info(`[${browserId}] Closing isolated browser (lived ${duration}ms)`);

	try {
		await browserInstance.page.close();
		await browserInstance.browser.close();
		activeBrowsers.delete(browserId);
		logger.info(`[${browserId}] ✅ Browser closed successfully`);
	} catch (error) {
		logger.error(`[${browserId}] Error closing browser:`, error);
		activeBrowsers.delete(browserId);
	}
}

/**
 * Check if Puppeteer is ready
 */
export function isPuppeteerReady(): boolean {
	return isInitialized;
}

/**
 * Wait for Puppeteer to be ready
 */
export async function waitForPuppeteerReady(
	timeout: number = 30000
): Promise<void> {
	const startTime = Date.now();

	while (!isPuppeteerReady()) {
		if (Date.now() - startTime > timeout) {
			throw new Error("Puppeteer initialization timeout");
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

/**
 * Get detailed browser pool status (for monitoring)
 */
export function getBrowserStatus() {
	return {
		initialized: isInitialized,
		activeBrowsers: activeBrowsers.size,
		browsers: Array.from(activeBrowsers.entries()).map(([id, instance]) => ({
			id,
			uptime: Date.now() - instance.startTime,
		})),
	};
}

/**
 * Get detailed Puppeteer metrics for monitoring
 */
export async function getPuppeteerMetrics() {
	const metrics = {
		initialized: isInitialized,
		activeBrowsers: activeBrowsers.size,
		totalPages: 0,
		browserMemoryUsage: 0,
		browserPerformance: [] as any[],
		systemResources: {
			nodeVersion: process.version,
			platform: process.platform,
			architecture: process.arch,
			uptime: process.uptime(),
		}
	};

	// Get detailed metrics for each browser
	for (const [browserId, browserInstance] of activeBrowsers.entries()) {
		try {
			const { browser, page, startTime } = browserInstance;
			const uptime = Date.now() - startTime;

			// Get browser targets (includes pages)
			const targets = browser.targets();
			const pages = targets.filter(target => target.type() === 'page');

			// Get performance metrics if available
			let performanceMetrics = null;
			try {
				const perfMetrics = await page.metrics();
				performanceMetrics = {
					jsHeapSizeUsed: perfMetrics.JSHeapUsedSize,
					jsHeapTotalSize: perfMetrics.JSHeapTotalSize,
					jsHeapSizeLimit: (perfMetrics as any).JSHeapSizeLimit || 0,
					tasks: perfMetrics.TaskDuration,
					layouts: perfMetrics.LayoutDuration,
					recalculates: perfMetrics.RecalcStyleDuration,
				};
			} catch (error) {
				// Performance metrics might not be available
			}

			metrics.browserPerformance.push({
				id: browserId,
				uptime,
				pageCount: pages.length,
				performance: performanceMetrics,
			});

			metrics.totalPages += pages.length;
		} catch (error) {
			logger.warn(`Error getting metrics for browser ${browserId}:`, error);
		}
	}

	return metrics;
}
