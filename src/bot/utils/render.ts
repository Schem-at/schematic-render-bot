import { Attachment, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { renderSchematic, renderSchematicVideo } from "../../services/renderer";
import { logger } from "../../shared/logger";

const SUPPORTED_FORMATS = ['schem', 'litematic'];
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

export interface RenderCustomOptions {
	isometric?: boolean;
	background?: string;
	framing?: 'tight' | 'medium' | 'wide';
	width?: number;
	height?: number;
}

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

export async function render(
	attachment: Attachment,
	videoMode: boolean = false,
	customOptions: RenderCustomOptions = {}
) {
	logger.info(`Processing ${videoMode ? "video" : "image"} render ${attachment.url} with options:`, customOptions);

	const response = await fetch(attachment.url);
	if (!response.ok)
		throw new Error(`Failed to download attachment: ${response.statusText}`);

	const schematicBuffer = Buffer.from(await response.arrayBuffer());

	// Set up render options with custom overrides
	const renderOptions = videoMode ? {
		// Video settings
		duration: 5,
		width: customOptions.width || 1280,
		height: customOptions.height || 720,
		frameRate: 30,
		isometric: customOptions.isometric,
		background: customOptions.background,
		framing: customOptions.framing,
	} : {
		// Image settings
		width: customOptions.width || 1920,
		height: customOptions.height || 1080,
		format: "image/png" as const,
		quality: 0.95,
		isometric: customOptions.isometric,
		background: customOptions.background,
		framing: customOptions.framing,
	};

	// Render the schematic
	const renderer = videoMode ? renderSchematicVideo : renderSchematic;
	const renderedBuffer = await renderer(schematicBuffer, renderOptions);

	// Create Discord attachment
	return new AttachmentBuilder(renderedBuffer, {
		name: attachment.name.replace(/\.[^/.]+$/, "") + (videoMode ? "_animation.webm" : "_render.png"),
	});
}

export function createRenderActionButtons(attachmentUrl: string, currentOptions: RenderCustomOptions = {}): ActionRowBuilder<ButtonBuilder>[] {
	// Encode attachment URL in button custom IDs (truncate if too long)
	const urlHash = Buffer.from(attachmentUrl).toString('base64').substring(0, 50);

	// Row 1: View type buttons
	const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`render_iso_${urlHash}`)
			.setLabel("🏛️ Isometric")
			.setStyle(currentOptions.isometric ? ButtonStyle.Primary : ButtonStyle.Secondary)
			.setDisabled(currentOptions.isometric === true),
		new ButtonBuilder()
			.setCustomId(`render_persp_${urlHash}`)
			.setLabel("📐 Perspective")
			.setStyle(!currentOptions.isometric ? ButtonStyle.Primary : ButtonStyle.Secondary)
			.setDisabled(currentOptions.isometric === false || currentOptions.isometric === undefined),
		new ButtonBuilder()
			.setCustomId(`render_video_${urlHash}`)
			.setLabel("🎬 Video")
			.setStyle(ButtonStyle.Secondary)
	);

	// Row 2: Background options
	const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`render_bg_transparent_${urlHash}`)
			.setLabel("☁️ Transparent")
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId(`render_bg_dark_${urlHash}`)
			.setLabel("🌑 Dark BG")
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId(`render_bg_light_${urlHash}`)
			.setLabel("☀️ Light BG")
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId(`render_hd_${urlHash}`)
			.setLabel("✨ 4K")
			.setStyle(ButtonStyle.Secondary)
	);

	return [row1, row2];
}

// Store attachment URLs temporarily (in-memory cache with TTL)
const attachmentCache = new Map<string, { url: string, name: string, timestamp: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export function storeAttachmentUrl(urlHash: string, url: string, name: string) {
	attachmentCache.set(urlHash, { url, name, timestamp: Date.now() });

	// Clean up old entries
	for (const [key, value] of attachmentCache.entries()) {
		if (Date.now() - value.timestamp > CACHE_TTL) {
			attachmentCache.delete(key);
		}
	}
}

export function getAttachmentFromCache(urlHash: string): { url: string, name: string } | null {
	const cached = attachmentCache.get(urlHash);
	if (!cached) return null;

	// Check if expired
	if (Date.now() - cached.timestamp > CACHE_TTL) {
		attachmentCache.delete(urlHash);
		return null;
	}

	return { url: cached.url, name: cached.name };
}