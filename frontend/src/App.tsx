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
	const [ffmpegReady, setFFmpegReady] = useState(false); // Add this


	useEffect(() => {
		const initFFmpegAsync = async () => {
			try {
				console.log("🎬 Loading FFmpeg...");

				// Use single-threaded version (no -mt suffix)
				const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

				await ffmpeg.load({
					coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
					wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
					// No workerURL needed for single-threaded version
				});

				console.log("✅ FFmpeg loaded successfully");
				setFFmpegReady(true);
			} catch (error) {
				console.error("❌ Failed to load FFmpeg:", error);
				setFFmpegReady(false);
			}
		};

		initFFmpegAsync();
	}, []);

	useEffect(() => {
		if (!ffmpegReady) return; // Wait for FFmpeg first!

		let mounted = true; // Add this variable

		const init = async () => {
			if (!canvasRef.current) return;

			try {
				// Polyfill crypto.subtle if not available (required for resource pack hash calculation)
				// This is needed when running over HTTP in Docker/containerized environments
				if (!window.crypto) {
					(window as any).crypto = {} as Crypto;
				}

				if (!window.crypto.subtle) {
					console.warn("⚠️ crypto.subtle is not available. Installing polyfill...");
					const protocol = window.location.protocol;
					const isSecureContext = window.isSecureContext;
					console.warn(`   Protocol: ${protocol}, Secure Context: ${isSecureContext}`);

					// SHA-256 polyfill - basic implementation for non-HTTPS contexts
					// This provides a deterministic hash for resource pack caching
					(window.crypto as any).subtle = {
						digest: async (algorithm: string, data: ArrayBuffer): Promise<ArrayBuffer> => {
							if (algorithm === 'SHA-256') {
								// Simple SHA-256-like hash implementation
								// This is a simplified version that produces consistent hashes
								const bytes = new Uint8Array(data);
								const result = new ArrayBuffer(32);
								const view = new DataView(result);

								// Use a simple hash that spreads across all 32 bytes
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

								// Write the hash values to the result buffer
								view.setUint32(0, h1, false);
								view.setUint32(4, h2, false);
								view.setUint32(8, h3, false);
								view.setUint32(12, h4, false);
								// Fill remaining bytes with a mix of the hash values
								for (let i = 16; i < 32; i++) {
									view.setUint8(i, ((h1 + h2 + h3 + h4) >>> (i % 4 * 8)) & 0xff);
								}

								return result;
							}
							throw new Error(`Unsupported algorithm: ${algorithm}`);
						}
					};
					console.warn("   ⚠️ Using fallback SHA-256 implementation for non-HTTPS context");
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

				if (ffmpeg && !ffmpeg.loaded) {
					console.warn("FFmpeg instance exists but is not loaded yet");
				}

				const renderer = new SchematicRenderer(
					canvasRef.current,
					{},
					{
						vanillaPack: async () => {
							console.log("Loading pack.zip...");
							const response = await fetch("/pack.zip");
							if (!response.ok) {
								throw new Error(`Failed to load pack.zip: ${response.status}`);
							}
							const buffer = await response.arrayBuffer();
							console.log("✅ pack.zip loaded, size:", buffer.byteLength);
							return new Blob([buffer], { type: "application/zip" });
						},
					},
					{
						enableAdaptiveFPS: false,

						ffmpeg: ffmpeg,
						enableDragAndDrop: true,
						// Disable visual helpers for cleaner screenshots
						showGrid: false,
						showAxes: false,
						showCameraPathVisualization: false,
						showRenderingBoundsHelper: false,
						// Set camera preset during initialization
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
								console.log("🎨 onSchematicRendered fired for:", schematicName);

								// Use setTimeout to ensure this doesn't block
								setTimeout(async () => {
									// Small delay to ensure canvas has rendered
									await new Promise(resolve => setTimeout(resolve, 300));

									// Force a few renders to ensure canvas is updated
									for (let i = 0; i < 3; i++) {
										rendererRef.current?.renderManager?.render();
										await new Promise(resolve => requestAnimationFrame(resolve));
									}

									// Get final scene stats
									const scene = rendererRef.current?.sceneManager?.scene;
									const meshCount = scene?.children.filter(
										(child: any) => child.type === 'Mesh' || child.type === 'Group'
									).length || 0;

									console.log("📊 Scene stats:", {
										meshCount,
										totalChildren: scene?.children.length,
										canvasSize: {
											width: rendererRef.current?.renderManager?.renderer.domElement.width,
											height: rendererRef.current?.renderManager?.renderer.domElement.height
										}
									});

									// Fire event for puppeteer backend
									const event = new CustomEvent("schematicRenderComplete", {
										detail: {
											schematicName,
											meshCount,
											buildTimeMs: performance.now(),
										},
									});
									window.dispatchEvent(event);
									console.log("📡 Fired schematicRenderComplete event with", meshCount, "meshes");
								}, 0);
							},
						},
					}
				);

				rendererRef.current = renderer;
			} catch (error) {
				console.error("❌ Failed to initialize SchematicRenderer:", error);
				setStatus("error");
				window.schematicRendererInitialized = false;
			}
		};

		// Expose global helper functions for Puppeteer
		window.schematicHelpers = {
			// Around line 104-120, replace the loadSchematic function:
			loadSchematic: async (
				name: string,
				data: string | ArrayBuffer
			): Promise<void> => {
				if (!rendererRef.current?.schematicManager) {
					throw new Error("Renderer not initialized");
				}

				console.log(`🔄 Loading schematic: ${name}`);

				const buffer =
					typeof data === "string" ? base64ToArrayBuffer(data) : data;

				try {
					// Clear any existing schematic first
					try {
						if (rendererRef.current?.schematicManager) {
							await rendererRef.current.schematicManager.removeAllSchematics();
						}
					} catch (clearError) {
						console.warn(
							"Failed to clear existing schematics, continuing:",
							clearError
						);
					}

					// Load new schematic - THIS is async and must be awaited!
					if (rendererRef.current?.schematicManager) {
						await rendererRef.current.schematicManager.loadSchematic(
							name,
							buffer,
							{}
						);
					}

					// Now get the schematic object and wait for meshes to be ready
					const schematicObject = rendererRef.current?.schematicManager?.schematics.get(name);
					if (schematicObject) {
						console.log("⏳ Waiting for meshes to be built...");
						// getMeshes() is public and waits for meshesReady internally
						const meshes = await schematicObject.getMeshes();
						console.log(`✅ Meshes are ready! Built ${meshes.length} mesh objects`);
					}

					setCurrentSchematic(name);
					console.log(`✅ Schematic fully loaded: ${name}`);
				} catch (error) {
					console.error(`❌ Failed to load schematic: ${error}`);
					throw error;
				}
			},
			startVideoRecording: async (options = {}): Promise<Blob> => {
				if (!rendererRef.current?.cameraManager?.recordingManager) {
					throw new Error("Recording manager not available");
				}

				console.log("Starting video recording with options:", options);

				const defaultOptions = {
					duration: 4,
					width: 1920,
					height: 1080,
					frameRate: 24,
				};

				const recordingOptions = { ...defaultOptions, ...options };

				try {
					// Set up circular path around schematic
					rendererRef.current.cameraManager.cameraPathManager.fitCircularPathToSchematics(
						"circularPath"
					);

					// Hide UI elements during recording
					rendererRef.current.cameraManager.cameraPathManager.hidePathVisualization(
						"circularPath"
					);

					// Return promise that resolves with the video blob
					const videoBlob = await new Promise<Blob>((resolve, reject) => {
						rendererRef.current!.cameraManager.recordingManager
							.startRecording(recordingOptions.duration, {
								width: recordingOptions.width,
								height: recordingOptions.height,
								frameRate: recordingOptions.frameRate,
								onProgress: (progress) => {
									console.log(`Recording progress: ${progress}%`);
								},
								onComplete: (blob) => {
									console.log("✅ Video recording completed");
									resolve(blob);
								},
							})
							.catch(reject);
					});

					return videoBlob;
				} catch (error) {
					console.error("❌ Video recording failed:", error);
					throw error;
				}
			},


			takeScreenshot: async (options = {}): Promise<Blob> => {
				if (!rendererRef.current?.cameraManager?.recordingManager) {
					throw new Error("Recording manager not available");
				}

				console.log("📸 Taking screenshot with options:", options);

				const defaultOptions = {
					width: 1920,
					height: 1080,
					format: "image/png" as const,
					quality: 0.9,
				};

				const screenshotOptions = { ...defaultOptions, ...options };

				try {
					// Debug: Check scene state BEFORE taking screenshot
					const scene = rendererRef.current.sceneManager?.scene;
					const renderer = rendererRef.current.renderManager?.renderer;
					const camera = rendererRef.current.cameraManager?.activeCamera?.camera as THREE.PerspectiveCamera;

					console.log("🔍 Pre-screenshot state:", {
						sceneChildren: scene?.children.length,
						meshes: scene?.children.filter((c: any) => c.type === 'Mesh' || c.type === 'Group').length,
						canvasSize: { width: renderer?.domElement.width, height: renderer?.domElement.height },
						cameraAspect: camera?.aspect
					});

					// Store original settings to restore after
					const originalWidth = renderer?.domElement.width || 0;
					const originalHeight = renderer?.domElement.height || 0;
					const originalPixelRatio = renderer?.getPixelRatio() || 1;
					const originalAspect = camera?.aspect || 1;

					// Manually resize canvas and update camera BEFORE calling takeScreenshot
					const targetWidth = screenshotOptions.width;
					const targetHeight = screenshotOptions.height;
					const targetAspect = targetWidth / targetHeight;

					console.log(`📐 Pre-resizing canvas to ${targetWidth}x${targetHeight} (aspect: ${targetAspect.toFixed(2)})`);

					renderer?.setPixelRatio(1.0);
					renderer?.setSize(targetWidth, targetHeight, false);
					camera.aspect = targetAspect;
					camera.updateProjectionMatrix();

					// Now refocus the camera for the new aspect ratio
					console.log("🎯 Refocusing camera for new aspect ratio...");
					await rendererRef.current.cameraManager.focusOnSchematics({
						animationDuration: 0,
						padding: 0.15
					});

					// Force render passes to stabilize
					for (let i = 0; i < 3; i++) {
						rendererRef.current.renderManager?.render();
						await new Promise(resolve => requestAnimationFrame(resolve));
					}

					console.log("📷 Taking screenshot with pre-configured canvas...");

					// Now call takeScreenshot - it will resize again but to the same size (no-op)
					const blob = await rendererRef.current.cameraManager.recordingManager.takeScreenshot(
						screenshotOptions
					);

					// Restore original settings (takeScreenshot also restores, but this ensures it)
					console.log(`🔄 Restoring canvas to ${originalWidth}x${originalHeight}`);
					renderer?.setSize(originalWidth, originalHeight, false);
					renderer?.setPixelRatio(originalPixelRatio);
					camera.aspect = originalAspect;
					camera.updateProjectionMatrix();

					// Refocus for original aspect ratio
					await rendererRef.current.cameraManager.focusOnSchematics({
						animationDuration: 0,
						padding: 0.15
					});

					console.log("✅ Screenshot blob size:", blob.size, "bytes");

					// Warn if blob is suspiciously small
					if (blob.size < 5000) {
						console.warn("⚠️ Screenshot is very small! Might be empty. Expected >5KB for a real image.");
					}

					return blob;
				} catch (error) {
					console.error("❌ Screenshot failed:", error);
					throw error;
				}
			},

			downloadScreenshot: async (options = {}): Promise<void> => {
				console.log("Downloading screenshot with options:", options);

				// Call our own takeScreenshot with all the stabilization logic
				const blob = await window.schematicHelpers!.takeScreenshot(options);
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = 'screenshot.png';
				a.click();
				URL.revokeObjectURL(url);
			},

			clearScene: async (): Promise<void> => {
				if (!rendererRef.current?.schematicManager) {
					throw new Error("Renderer not initialized");
				}

				console.log("Clearing scene...");
				try {
					rendererRef.current.schematicManager.removeAllSchematics();
					setCurrentSchematic("none");
				} catch (error) {
					console.warn("Clear scene failed, continuing anyway:", error);
				}

				return new Promise((resolve) => {
					requestAnimationFrame(() => {
						setTimeout(resolve, 100);
					});
				});
			},

			isReady: (): boolean => {
				return !!(rendererRef.current && window.schematicRendererInitialized);
			},

			waitForReady: (): Promise<boolean> => {
				console.log("waitForReady called");
				return new Promise((resolve) => {
					const check = () => {
						const ready = window.schematicHelpers?.isReady();
						console.log("waitForReady check:", ready);
						if (ready) {
							console.log("waitForReady resolving!");
							resolve(true);
						} else {
							setTimeout(check, 100);
						}
					};
					check();
				});
			},
		};

		init();

		return () => {
			mounted = false;

			if (rendererRef.current) {
				console.log("Disposing renderer...");
				rendererRef.current.dispose?.();
				rendererRef.current = null;
			}

			// Clean up global helpers - now safe to delete
			if (window.schematicHelpers) {
				delete window.schematicHelpers;
			}
			window.schematicRendererInitialized = false;
		};
	}, [ffmpegReady]);

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
