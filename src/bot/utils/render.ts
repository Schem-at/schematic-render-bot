import { Attachment, AttachmentBuilder } from "discord.js";
import { renderSchematic, renderSchematicVideo } from "../../services/renderer";
import { logger } from "../../shared/logger";

const SUPPORTED_FORMATS = ['schem', 'litematic'];
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

export function checkError(attachment: Attachment | null) {
	// Check schematic existance
	if (attachment == null)
		return "❌ Schematic not found";

	// Check schem format
	const format = attachment.name.split('.').slice(1).pop() ?? '';
	if (!SUPPORTED_FORMATS.includes(format))
		return `❌ Invalid file format "${format}". Supported formats: ${SUPPORTED_FORMATS.join(", ")}`;

	// Check file size
	if (attachment.size > MAX_FILE_SIZE)
		return `❌ This file is ${Math.floor(attachment.size / 1024)} ko and exceeds the limit of ${MAX_FILE_SIZE / 1024} ko`;

	// Everything's fine
	return null;
}

export async function render(attachment: Attachment, videoMode: boolean = false) {
	logger.info(`Processing ${videoMode ? "video" : "image"} render ${attachment.url}`);

	const response = await fetch(attachment.url);
	if (!response.ok)
		throw new Error(`Failed to download attachment: ${response.statusText}`);

	const schematicBuffer = Buffer.from(await response.arrayBuffer());

	// Set up render options
	// TODO: Editable settings
	const renderOptions = videoMode ? {
		// Video settings
		duration: 5,
		width: 1280,
		height: 720,
		frameRate: 30,
	} : {
		// Image settings
		width: 1920,
		height: 1080,
		format: "image/png" as const,
		quality: 0.95,
	};

	// Render the schematic
	const renderer = videoMode ? renderSchematicVideo : renderSchematic;
	const renderedBuffer = await renderer(schematicBuffer, renderOptions);

	// Create Discord attachment
	return new AttachmentBuilder(renderedBuffer, {
		name: attachment.name.replace(/\.[^/.]+$/, "") + (videoMode ? "_animation.webm" : "_render.png"),
	});
}