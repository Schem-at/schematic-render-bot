import "./App.css";
import { SchematicRenderer } from "schematic-renderer";
import { useRef, useEffect, useState } from "react";
import * as THREE from "three";
(window as any).THREE = THREE;
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

const ffmpeg = new FFmpeg();

function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binaryString = atob(base64);
	const len = binaryString.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes.buffer;
}

// TypeScript declarations for global helpers
declare global {
	interface Window {
		schematicHelpers?: {
			// Made optional
			loadSchematic: (
				name: string,
				data: string | ArrayBuffer
			) => Promise<void>;
			startVideoRecording: (options?: {
				duration?: number;
				width?: number;
				height?: number;
				frameRate?: number;
			}) => Promise<Blob>;
			takeScreenshot: (options?: any) => Promise<Blob>;
			downloadScreenshot: (options?: any) => Promise<void>;
			isReady: () => boolean;
			waitForReady: () => Promise<boolean>;
			clearScene: () => Promise<void>;
		};
		schematicRendererInitialized?: boolean; // Made optional
		rendererRef?: any; // Expose for debugging in puppeteer
	}
}

export function App() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const rendererRef = useRef<SchematicRenderer | null>(null);
	const [status, setStatus] = useState<"initializing" | "ready" | "error">(
		"initializing"
	);
	const [currentSchematic, setCurrentSchematic] = useState<string>("none");


	useEffect(() => {
		let mounted = true;

		const init = async () => {
			if (!canvasRef.current) return;

			try {
				console.log("🎬 Initiating FFmpeg loading in background...");
				// Start FFmpeg loading but don't await it here if we just want to render images
				const initFFmpegAsync = async () => {
					try {
						// Use single-threaded version (no -mt suffix)
						const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

						await ffmpeg.load({
							coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
							wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
						});

						console.log("✅ FFmpeg loaded successfully");
					} catch (error) {
						console.error("❌ Failed to load FFmpeg:", error);
					}
				};
				initFFmpegAsync();

				// Polyfill crypto.subtle if not available (required for resource pack hash calculation)
				if (!window.crypto) {
					(window as any).crypto = {} as Crypto;
				}

				if (!window.crypto.subtle) {
					console.warn("⚠️ crypto.subtle is not available. Installing polyfill...");
					(window.crypto as any).subtle = {
						digest: async (algorithm: string, data: ArrayBuffer): Promise<ArrayBuffer> => {
							if (algorithm === 'SHA-256') {
								const bytes = new Uint8Array(data);
								const result = new ArrayBuffer(32);
								const view = new DataView(result);
								let h1 = 0x67452301;
								let h2 = 0xEFCDAB89;
								let h3 = 0x98BADCFE;
								let h4 = 0x10325476;
								for (let i = 0; i < bytes.length; i++) {
									const byte = bytes[i];
									h1 = ((h1 << 5) | (h1 >>> 27)) + byte;
									h2 = ((h2 << 3) | (h2 >>> 29)) ^ byte;
									h3 = ((h3 << 7) | (h3 >>> 25)) + byte;
									h4 = ((h4 << 11) | (h4 >>> 21)) ^ byte;
								}
								view.setUint32(0, h1, false);
								view.setUint32(4, h2, false);
								view.setUint32(8, h3, false);
								view.setUint32(12, h4, false);
								for (let i = 16; i < 32; i++) {
									view.setUint8(i, ((h1 + h2 + h3 + h4) >>> (i % 4 * 8)) & 0xff);
								}
								return result;
							}
							throw new Error(`Unsupported algorithm: ${algorithm}`);
						}
					};
				}

				console.log("Initializing SchematicRenderer...");
				setStatus("initializing");

				// Read render options from URL parameters (set by backend)
				const urlParams = new URLSearchParams(window.location.search);
				const isometric = urlParams.get('isometric') === 'true';
				const background = urlParams.get('background') || 'transparent';
				const cameraPreset = isometric ? 'isometric' : 'perspective';

				console.log(`📐 Initializing renderer with camera preset: ${cameraPreset}, background: ${background}`);

				// Check if pack.zip is accessible
				try {
					const packResponse = await fetch("/pack.zip");
					if (!packResponse.ok) {
						throw new Error(`pack.zip not found: ${packResponse.status}`);
					}
					console.log("✅ pack.zip is accessible");
				} catch (packError: any) {
					console.error("❌ pack.zip check failed:", packError);
					throw new Error(`Missing pack.zip file: ${packError.message}`);
				}

				const renderer = new SchematicRenderer(
					canvasRef.current,
					{},
					{
						vanillaPack: async () => {
							const response = await fetch("/pack.zip");
							if (!response.ok) {
								throw new Error(`Failed to load pack.zip: ${response.status}`);
							}
							const buffer = await response.arrayBuffer();
							return new Blob([buffer], { type: "application/zip" });
						},
					},
					{
						enableAdaptiveFPS: false,
						ffmpeg: ffmpeg,
						enableDragAndDrop: true,
						showGrid: false,
						showAxes: false,
						showCameraPathVisualization: false,
						showRenderingBoundsHelper: false,
						cameraOptions: {
							defaultCameraPreset: cameraPreset as "perspective" | "isometric",
						},
						callbacks: {
							onRendererInitialized: async (
								rendererInstance: SchematicRenderer
							) => {
								if (!mounted) return;
								console.log("✅ SchematicRenderer initialized successfully");
								rendererRef.current = rendererInstance;
								setStatus("ready");

								window.schematicRendererInitialized = true;
								// Expose for debugging in puppeteer
								window.rendererRef = rendererRef;
							},
							onSchematicRendered: (schematicName: string) => {
								setTimeout(async () => {
									await new Promise(resolve => setTimeout(resolve, 300));
									for (let i = 0; i < 3; i++) {
										rendererRef.current?.renderManager?.render();
										await new Promise(resolve => requestAnimationFrame(resolve));
									}
									const scene = rendererRef.current?.sceneManager?.scene;
									const meshCount = scene?.children.filter(
										(child: any) => child.type === 'Mesh' || child.type === 'Group'
									).length || 0;

									const event = new CustomEvent("schematicRenderComplete", {
										detail: {
											schematicName,
											meshCount,
											buildTimeMs: performance.now(),
										},
									});
									window.dispatchEvent(event);
								}, 0);
							},
						},
					}
				);

				rendererRef.current = renderer;

				// Expose global helper functions for Puppeteer
				window.schematicHelpers = {
					loadSchematic: async (
						name: string,
						data: string | ArrayBuffer
					): Promise<void> => {
						if (!rendererRef.current?.schematicManager) {
							throw new Error("Renderer not initialized");
						}
						const buffer = typeof data === "string" ? base64ToArrayBuffer(data) : data;
						try {
							await rendererRef.current.schematicManager.removeAllSchematics();
						} catch (e) {}
						await rendererRef.current.schematicManager.loadSchematic(name, buffer, {});
						const schematicObject = rendererRef.current.schematicManager.schematics.get(name);
						if (schematicObject) await schematicObject.getMeshes();
						setCurrentSchematic(name);
					},
					startVideoRecording: async (options = {}): Promise<Blob> => {
						if (!ffmpeg.loaded) {
							throw new Error("FFmpeg not loaded yet. Please wait for the 'ready' status or check console.");
						}
						if (!rendererRef.current?.cameraManager?.recordingManager) {
							throw new Error("Recording manager not available");
						}
						const recordingOptions = { duration: 4, width: 1920, height: 1080, frameRate: 24, ...options };
						rendererRef.current.cameraManager.cameraPathManager.fitCircularPathToSchematics("circularPath");
						rendererRef.current.cameraManager.cameraPathManager.hidePathVisualization("circularPath");
						return new Promise<Blob>((resolve, reject) => {
							rendererRef.current!.cameraManager.recordingManager
								.startRecording(recordingOptions.duration, {
									width: recordingOptions.width,
									height: recordingOptions.height,
									frameRate: recordingOptions.frameRate,
									onProgress: (p) => console.log(`Recording progress: ${p}%`),
									onComplete: (blob) => resolve(blob),
								})
								.catch(reject);
						});
					},
					takeScreenshot: async (options = {}): Promise<Blob> => {
						if (!rendererRef.current?.cameraManager?.recordingManager) {
							throw new Error("Recording manager not available");
						}
						const screenshotOptions = { width: 1920, height: 1080, format: "image/png" as const, quality: 0.9, ...options };
						const renderer = rendererRef.current.renderManager?.renderer;
						const camera = rendererRef.current.cameraManager?.activeCamera?.camera as THREE.PerspectiveCamera;
						const originalWidth = renderer?.domElement.width || 0;
						const originalHeight = renderer?.domElement.height || 0;
						const originalPixelRatio = renderer?.getPixelRatio() || 1;
						const originalAspect = camera?.aspect || 1;
						const targetWidth = screenshotOptions.width;
						const targetHeight = screenshotOptions.height;
						renderer?.setPixelRatio(1.0);
						renderer?.setSize(targetWidth, targetHeight, false);
						if (camera) { camera.aspect = targetWidth / targetHeight; camera.updateProjectionMatrix(); }
						await rendererRef.current.cameraManager.focusOnSchematics({ animationDuration: 0, padding: 0.15 });
						for (let i = 0; i < 3; i++) {
							rendererRef.current.renderManager?.render();
							await new Promise(resolve => requestAnimationFrame(resolve));
						}
						const blob = await rendererRef.current.cameraManager.recordingManager.takeScreenshot(screenshotOptions);
						renderer?.setSize(originalWidth, originalHeight, false);
						renderer?.setPixelRatio(originalPixelRatio);
						if (camera) { camera.aspect = originalAspect; camera.updateProjectionMatrix(); }
						await rendererRef.current.cameraManager.focusOnSchematics({ animationDuration: 0, padding: 0.15 });
						return blob;
					},
					downloadScreenshot: async (options = {}) => {
						const blob = await window.schematicHelpers!.takeScreenshot(options);
						const url = URL.createObjectURL(blob);
						const a = document.createElement('a');
						a.href = url; a.download = 'screenshot.png'; a.click();
						URL.revokeObjectURL(url);
					},
					clearScene: async (): Promise<void> => {
						if (!rendererRef.current?.schematicManager) throw new Error("Renderer not initialized");
						rendererRef.current.schematicManager.removeAllSchematics();
						setCurrentSchematic("none");
						return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 100)));
					},
					isReady: (): boolean => !!(rendererRef.current && window.schematicRendererInitialized),
					waitForReady: (): Promise<boolean> => {
						return new Promise((resolve) => {
							const check = () => {
								if (window.schematicHelpers?.isReady()) resolve(true);
								else setTimeout(check, 100);
							};
							check();
						});
					},
				};

			} catch (error) {
				console.error("❌ Failed to initialize SchematicRenderer:", error);
				if (mounted) setStatus("error");
				window.schematicRendererInitialized = false;
			}
		};

		init();

		return () => {
			mounted = false;
			if (rendererRef.current) {
				rendererRef.current.dispose?.();
				rendererRef.current = null;
			}
			if (window.schematicHelpers) delete window.schematicHelpers;
			window.schematicRendererInitialized = false;
		};
	}, []);

	// Status indicator component
	const StatusIndicator = () => {
		const getStatusColor = () => {
			switch (status) {
				case "initializing":
					return "bg-yellow-500";
				case "ready":
					return "bg-green-500";
				case "error":
					return "bg-red-500";
				default:
					return "bg-gray-500";
			}
		};

		const getStatusText = () => {
			switch (status) {
				case "initializing":
					return "Initializing...";
				case "ready":
					return "Ready";
				case "error":
					return "Error";
				default:
					return "Unknown";
			}
		};

		return (
			<div className="absolute top-4 left-4 flex items-center space-x-2 bg-black bg-opacity-50 px-3 py-2 rounded-lg text-white text-sm">
				<div className={`w-3 h-3 rounded-full ${getStatusColor()}`}></div>
				<span>Status: {getStatusText()}</span>
				{status === "ready" && (
					<span className="text-gray-300">| Schematic: {currentSchematic}</span>
				)}
			</div>
		);
	};

	return (
		<div className="bg-gray-900 h-screen w-screen flex items-center justify-center relative overflow-hidden max-h-100vh">
			<StatusIndicator />

			{import.meta.env.DEV && (
				<div className="absolute top-4 right-4 bg-black bg-opacity-70 text-white p-4 rounded-lg text-xs max-w-xs">
					<h3 className="font-bold mb-2">Puppeteer API Ready</h3>
					<div className="space-y-1">
						<div>• window.schematicHelpers.loadSchematic(name, data)</div>
						<div>• window.schematicHelpers.takeScreenshot(options)</div>
						<div>• window.schematicHelpers.downloadScreenshot(options)</div>
						<div>• window.schematicHelpers.isReady()</div>
						<div>• window.schematicHelpers.waitForReady()</div>
					</div>
				</div>
			)}

			{status === "error" && (
				<div className="absolute inset-0 flex items-center justify-center bg-red-900 bg-opacity-50">
					<div className="bg-red-800 text-white p-6 rounded-lg text-center">
						<h2 className="text-xl font-bold mb-2">Initialization Failed</h2>
						<p>Check console for details</p>
					</div>
				</div>
			)}

			<canvas
				ref={canvasRef}
				id="canvas"
				width={1920}
				height={1080}
				className="max-w-full max-h-full object-contain max-h-100vh"
				style={{
					display: status === "error" ? "none" : "block",
					background: "transparent",
				}}
			/>

			{status === "initializing" && (
				<div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
					<div className="text-white text-center">
						<div className="animate-spin rounded-full h-16 w-16 border-b-2 border-white mx-auto mb-4"></div>
						<p>Initializing Schematic Renderer...</p>
					</div>
				</div>
			)}
		</div>
	);
}

export default App;
