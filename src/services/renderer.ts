import { createIsolatedBrowser, closeIsolatedBrowser, waitForPuppeteerReady } from "./puppeteer.js";
import { RenderOptions, VideoRenderOptions } from "../shared/types.js";
import { logger } from "../shared/logger.js";
import { trackRenderStart, trackRenderComplete, trackRenderError } from "./metrics.js";

declare global {
	interface Window {
		schematicRendererInitialized: boolean;
		THREE: any;
		schematicHelpers: {
			waitForReady: () => Promise<void>;
			isReady: () => boolean;
			loadSchematic: (id: string, data: string) => Promise<void>;
			takeScreenshot: (options: {
				width: number;
				height: number;
				format: "image/png" | "image/jpeg";
			}) => Promise<Blob>;
			startVideoRecording: (options?: {
				duration?: number;
				width?: number;
				height?: number;
				frameRate?: number;
			}) => Promise<Blob>;
		};
	}
}

export async function renderSchematic(
	schematicData: Buffer,
	options: RenderOptions = {}
): Promise<Buffer> {
	// Wait for Puppeteer to be ready
	await waitForPuppeteerReady();

	// Create a new isolated browser instance for this render
	const { browser, page, id: browserId } = await createIsolatedBrowser();
	const startTime = Date.now();

	trackRenderStart(browserId, 'image', schematicData.length);

	try {
		logger.info(`[${browserId}] Rendering schematic, size: ${schematicData.length} bytes`);

		// Convert buffer to base64 for easier transmission
		const base64Data = schematicData.toString("base64");

		// Setup event listener BEFORE loading schematic and wait for completion
		logger.info(`[${browserId}] Waiting for schematic render to complete...`);
		const renderData: any = await page.evaluate(async (data) => {
			// Setup event listener FIRST
			const renderPromise = new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error("Schematic render timeout after 120 seconds"));
				}, 120000);

				window.addEventListener(
					"schematicRenderComplete",
					(event: any) => {
						clearTimeout(timeout);
						console.log("🎉 Puppeteer caught render complete event:", event.detail);
						resolve(event.detail);
					},
					{ once: true }
				);

				console.log("✅ Event listener registered for schematicRenderComplete");
			});

			// THEN load schematic (will trigger the event)
			try {
				console.log("🔄 Loading schematic...");
				await window.schematicHelpers.loadSchematic("api-schematic", data);
				console.log("✅ Schematic loading initiated");
			} catch (error: any) {
				console.error("❌ Failed to load schematic:", error.message || error);
				throw error;
			}

			// Wait for the render complete event
			console.log("⏳ Waiting for render complete event...");
			return renderPromise;
		}, base64Data);

		logger.info(
			`[${browserId}] Schematic rendered successfully: ${renderData.meshCount} meshes in ${renderData.buildTimeMs}ms`
		);

		// Add extra delay to ensure canvas is fully updated after render event
		logger.info(`[${browserId}] Waiting for canvas to stabilize...`);
		await new Promise(resolve => setTimeout(resolve, 1000));

		// Take screenshot with detailed logging
		logger.info(`[${browserId}] Taking screenshot...`);
		const screenshotBlob = await page.evaluate(async (opts) => {
			if (window.schematicHelpers == undefined) {
				throw new Error("Schematic helpers not initialized");
			}

			// Log scene state before screenshot
			const scene = (window as any).rendererRef?.current?.sceneManager?.scene;
			const canvas = (window as any).rendererRef?.current?.renderManager?.renderer.domElement;
			console.log("📊 Pre-screenshot state:", {
				sceneChildren: scene?.children.length,
				canvasWidth: canvas?.width,
				canvasHeight: canvas?.height,
			});

			console.log("📸 Taking screenshot with options:", JSON.stringify(opts, null, 2));

			const blob = await window.schematicHelpers.takeScreenshot({
				width: opts.width || 1920,
				height: opts.height || 1080,
				format: opts.format || "image/png",
			});

			console.log("✅ Screenshot blob size:", blob.size);

			const arrayBuffer = await blob.arrayBuffer();
			return Array.from(new Uint8Array(arrayBuffer));
		}, options);

		logger.info(`[${browserId}] Screenshot blob received, size: ${screenshotBlob.length} bytes`);

		const duration = Date.now() - startTime;
		trackRenderComplete(browserId, duration, renderData.meshCount);

		return Buffer.from(screenshotBlob);
	} catch (error) {
		logger.error(`[${browserId}] Error in renderSchematic:`, error);
		trackRenderError(browserId, error);
		throw error;
	} finally {
		// Always close the isolated browser instance
		await closeIsolatedBrowser(browserId);
	}
}


export async function renderSchematicVideo(
	schematicData: Buffer,
	options: VideoRenderOptions = {}
): Promise<Buffer> {
	await waitForPuppeteerReady();

	// Create a new isolated browser instance for this render
	const { browser, page, id: browserId } = await createIsolatedBrowser();
	const startTime = Date.now();

	trackRenderStart(browserId, 'video', schematicData.length);

	try {
		logger.info(`[${browserId}] Rendering schematic video, size: ${schematicData.length} bytes`);

		const base64Data = schematicData.toString("base64");

		// Load schematic and wait for completion
		logger.info(`[${browserId}] Loading schematic for video recording...`);
		const renderData: any = await page.evaluate(async (data) => {
			const renderPromise = new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error("Schematic render timeout after 120 seconds"));
				}, 120000);

				window.addEventListener(
					"schematicRenderComplete",
					(event: any) => {
						clearTimeout(timeout);
						console.log("🎉 Schematic loaded for video:", event.detail);
						resolve(event.detail);
					},
					{ once: true }
				);
			});

			try {
				await window.schematicHelpers.loadSchematic("api-schematic", data);
			} catch (error: any) {
				throw error;
			}

			return renderPromise;
		}, base64Data);

		logger.info(`[${browserId}] Schematic loaded, starting video recording...`);

		// Add extra delay to ensure canvas is fully updated
		await new Promise(resolve => setTimeout(resolve, 1000));

		// Record video
		const videoBlob = await page.evaluate(async (opts) => {
			if (!window.schematicHelpers?.startVideoRecording) {
				throw new Error("Video recording not available - startVideoRecording function missing");
			}

			console.log("Starting video recording with options:", JSON.stringify(opts, null, 2));

			const blob = await window.schematicHelpers.startVideoRecording({
				duration: opts.duration || 6,
				width: opts.width || 1920,
				height: opts.height || 1080,
				frameRate: opts.frameRate || 30,
			});

			const arrayBuffer = await blob.arrayBuffer();
			return Array.from(new Uint8Array(arrayBuffer));
		}, options);

		const duration = Date.now() - startTime;
		trackRenderComplete(browserId, duration, renderData.meshCount);

		logger.info(`[${browserId}] Video recording completed successfully`);
		return Buffer.from(videoBlob);

	} catch (error) {
		logger.error(`[${browserId}] Error in renderSchematicVideo:`, error);
		trackRenderError(browserId, error);
		throw error;
	} finally {
		// Always close the isolated browser instance
		await closeIsolatedBrowser(browserId);
	}
}