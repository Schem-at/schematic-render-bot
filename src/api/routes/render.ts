import { Router } from "express";
import multer from "multer";
import { processRender, getCachedRender } from "../../services/render-service.js";
import { calculateHash, getFile } from "../../services/storage.js";
import { logger } from "../../shared/logger.js";

const router = Router();

const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: 100 * 1024 * 1024, // 100MB
	},
});

router.post(
	"/render-schematic",
	upload.single("schematic"),
	async (req, res) => {
		try {
			if (!req.file) {
				return res.status(400).json({ error: "Schematic file is required" });
			}

			logger.info(
				`Received schematic: ${req.file.originalname}, size: ${req.file.size} bytes`
			);

			const options = {
				width: parseInt(req.body.width) || 1920,
				height: parseInt(req.body.height) || 1080,
				format: req.body.format || "image/png",
				...JSON.parse(req.body.options || "{}"),
			};

			// Check cache first
			const fileHash = calculateHash(req.file.buffer);
			const cached = getCachedRender(fileHash, options);
			
			if (cached && req.query.cache !== 'false') {
				logger.info(`Using cached render: ${cached.id}`);
				// Get the cached artifact
				const artifactPath = cached.file_path;
				if (artifactPath) {
					const cachedBuffer = await getFile(fileHash);
					if (cachedBuffer) {
						const filename = `${req.file.originalname.replace(/\.[^/.]+$/, "")}.png`;
						res.set("Content-Type", "image/png");
						res.set("Content-Disposition", `attachment; filename="${filename}"`);
						res.set("X-Cache", "HIT");
						res.set("X-Render-Id", cached.id);
						return res.send(cachedBuffer);
					}
				}
			}

			// Process new render with full tracking
			const result = await processRender({
				schematicData: req.file.buffer,
				options,
				type: 'image',
				source: 'api',
				originalFilename: req.file.originalname,
				userId: req.ip || 'unknown',
			});

			const filename = `${req.file.originalname.replace(/\.[^/.]+$/, "")}.png`;
			res.set("Content-Type", "image/png");
			res.set("Content-Disposition", `attachment; filename="${filename}"`);
			res.set("X-Cache", "MISS");
			res.set("X-Render-Id", result.renderId);
			res.set("X-File-Hash", result.fileHash);
			res.send(result.outputBuffer);
		} catch (error: any) {
			logger.error("Schematic render error:", error);
			res
				.status(500)
				.json({ error: error.message || "Failed to render schematic" });
		}
	}
);

export { router as renderRouter };
