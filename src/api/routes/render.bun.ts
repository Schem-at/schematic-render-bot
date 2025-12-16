import { Router, json, getQuery } from "../../utils/router.js";
import { processRender, getCachedRender } from "../../services/render-service.js";
import { calculateHash, getFile } from "../../services/storage.js";
import { logger } from "../../shared/logger.js";

export function setupRenderRoutes(router: Router): void {
	/**
	 * Render schematic endpoint
	 */
	router.post("/api/render-schematic", async (req) => {
		try {
			// Parse multipart/form-data
			const formData = await req.formData();
			const schematicFile = formData.get("schematic") as File | null;

			if (!schematicFile || !(schematicFile instanceof File)) {
				return json({ error: "Schematic file is required" }, 400);
			}

			logger.info(`Received schematic: ${schematicFile.name}, size: ${schematicFile.size} bytes`);

			// Get options from form data
			const width = parseInt(formData.get("width")?.toString() || "1920");
			const height = parseInt(formData.get("height")?.toString() || "1080");
			const format = formData.get("format")?.toString() || "image/png";
			const optionsJson = formData.get("options")?.toString() || "{}";
			const options = {
				width,
				height,
				format,
				...JSON.parse(optionsJson),
			};

			// Convert File to Buffer
			const arrayBuffer = await schematicFile.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);

			// Check cache first
			const query = getQuery(req);
			const fileHash = calculateHash(buffer);
			const cached = getCachedRender(fileHash, options);

			if (cached && query.get("cache") !== "false") {
				logger.info(`Using cached render: ${cached.id}`);
				// Get the cached artifact
				const artifactPath = cached.file_path;
				if (artifactPath) {
					const cachedBuffer = await getFile(fileHash);
					if (cachedBuffer) {
						const filename = `${schematicFile.name.replace(/\.[^/.]+$/, "")}.png`;
						return new Response(cachedBuffer, {
							headers: {
								"Content-Type": "image/png",
								"Content-Disposition": `attachment; filename="${filename}"`,
								"X-Cache": "HIT",
								"X-Render-Id": cached.id,
							},
						});
					}
				}
			}

			// Process new render with full tracking
			const clientIp = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
			const result = await processRender({
				schematicData: buffer,
				options,
				type: "image",
				source: "api",
				originalFilename: schematicFile.name,
				userId: clientIp,
			});

			const filename = `${schematicFile.name.replace(/\.[^/.]+$/, "")}.png`;
			return new Response(result.outputBuffer, {
				headers: {
					"Content-Type": "image/png",
					"Content-Disposition": `attachment; filename="${filename}"`,
					"X-Cache": "MISS",
					"X-Render-Id": result.renderId,
					"X-File-Hash": result.fileHash,
				},
			});
		} catch (error: any) {
			logger.error("Schematic render error:", error);
			return json({ error: error.message || "Failed to render schematic" }, 500);
		}
	});
}
