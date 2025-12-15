import {
	Client,
	GatewayIntentBits,
	AttachmentBuilder,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
} from "discord.js";
import { logger } from "../shared/logger.js";
import { processRender } from "../services/render-service.js";
import { handleInteraction } from "./interaction-handlers.js";
import { createQuickActionsRow, getUserOptions } from "./render-options.js";
import { spawn, ChildProcess } from "child_process";
import { join } from "path";

let client: Client | null = null;

// Rate limiting: user ID -> { count, resetTime }
const rateLimits = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_MAX = 10; // 5 renders per 10 minutes
const RATE_LIMIT_WINDOW = 10 * 60 * 1000; // 10 minutes

// File size limits
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const SUPPORTED_FORMATS = [".schem", ".litematic"];

// Script execution interface
interface ScriptExecutionResult {
	hasSchematic?: boolean;
	schematic?: Buffer;
	[key: string]: any;
}

interface ChildProcessMessage {
	success: boolean;
	result?: {
		hasSchematic?: boolean;
		schematic?: string | Buffer;
		[key: string]: any;
	};
	error?: {
		message: string;
		name: string;
	};
}

export async function initDiscordBot(): Promise<void> {
	const token = process.env.DISCORD_TOKEN;

	if (!token) {
		logger.warn("Discord token not provided, skipping bot initialization");
		return;
	}

	try {
		client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
			],
		});

	client.once("clientReady", () => {
		logger.info(`✅ Discord bot logged in as ${client?.user?.tag}`);

		// Set bot activity
		client?.user?.setActivity("Minecraft schematics | !help", {
			type: "WATCHING" as any,
		});
	});

		client.on("error", (error) => {
			logger.error("Discord bot error:", error);
		});

		// Handle messages and commands
		client.on("messageCreate", async (message) => {
			if (message.author.bot) return;

			try {
				console.log(
					`📨 Message received from ${
						message.author.username
					}: "${message.content.substring(0, 100)}..."`
				);

				// Command handling
				if (message.content.startsWith("!")) {
					console.log(`🎯 Command detected: ${message.content.split("\n")[0]}`);
					await handleCommand(message);
					return;
				}

				// Auto-process schematic attachments (image only)
				if (message.attachments.size > 0) {
					console.log(`📎 Attachment detected`);
					await handleSchematicAttachments(message, "image");
				}
			} catch (error) {
				console.error("❌ Error handling message:", error);
				logger.error("Error handling message:", error);
				await safeReply(
					message,
					"❌ An unexpected error occurred while processing your request."
				);
			}
		});

	// Handle all interactions (buttons, select menus, modals)
	client.on("interactionCreate", async (interaction) => {
		try {
			await handleInteraction(interaction);
		} catch (error) {
			logger.error("Error handling interaction:", error);
		}
	});

		await client.login(token);
	} catch (error) {
		logger.error("Failed to initialize Discord bot:", error);
		throw error;
	}
}

/**
 * Handle bot commands
 */
async function handleCommand(message: any) {
	// Split on both spaces AND newlines to properly handle multiline messages
	const firstLine = message.content.slice(1).trim().split(/\s+/)[0] || "";
	const command = firstLine.toLowerCase();

	console.log(`🔧 Handling command: "${command}"`);
	console.log(
		`📝 Full message content length: ${message.content.length} characters`
	);

	switch (command) {
		case "ping":
			console.log(`✅ Routing to ping command`);
			await handlePingCommand(message);
			break;
		case "help":
			console.log(`✅ Routing to help command`);
			await handleHelpCommand(message);
			break;
		case "render":
			console.log(`✅ Routing to render command`);
			await handleRenderCommand(message, "image");
			break;
		case "video":
		case "animate":
			console.log(`✅ Routing to video command`);
			await handleRenderCommand(message, "video");
			break;
		case "script":
		case "code":
		case "js":
			console.log(`✅ Routing to script command`);
			await handleScriptCommand(message);
			break;
		case "status":
			console.log(`✅ Routing to status command`);
			await handleStatusCommand(message);
			break;
		case "info":
			console.log(`✅ Routing to info command`);
			await handleInfoCommand(message);
			break;
		default:
			console.log(`❓ Unknown command: "${command}" - ignoring silently`);
			// Unknown command - ignore silently
			break;
	}
}

/**
 * Handle script command - execute JavaScript code to generate schematics
 */
async function handleScriptCommand(message: any) {
	console.log(`🔍 Script command received from ${message.author.username}`);
	console.log(`📝 Message content: ${message.content}`);

	// Check rate limit first
	if (!checkRateLimit(message.author.id)) {
		const resetTime = getRateLimitReset(message.author.id);
		const embed = new EmbedBuilder()
			.setColor(0xff6b6b)
			.setTitle("⏰ Rate Limited")
			.setDescription(
				`You've reached the script execution limit. Try again in **${resetTime} minutes**.`
			)
			.addFields(
				{
					name: "Limit",
					value: `${RATE_LIMIT_MAX} executions per ${
						RATE_LIMIT_WINDOW / 60000
					} minutes`,
					inline: true,
				},
				{ name: "Reset Time", value: `${resetTime} minutes`, inline: true }
			);

		await message.reply({ embeds: [embed] });
		return;
	}

	// Extract JavaScript code from message
	const jsCode = extractJavaScriptCode(message.content);
	console.log(
		`🔍 Extracted code: ${jsCode ? jsCode.substring(0, 100) + "..." : "null"}`
	);

	if (!jsCode) {
		console.log(`❌ No code found in message`);
		const embed = new EmbedBuilder()
			.setColor(0xff6b6b)
			.setTitle("❌ No Code Found")
			.setDescription(
				"Please provide JavaScript code in a code block to execute."
			)
			.addFields(
				{
					name: "Example Usage",
					value:
						"```\n!script\n\\`\\`\\`js\nconst schem = new Schematic();\nfor(let y=0; y<10; y++) {\n  schem.set_block(0, y, 0, 'minecraft:stone');\n}\nreturn {schematic: schem};\n\\`\\`\\`\n```",
					inline: false,
				},
				{
					name: "Available Objects",
					value:
						"• `Schematic` - Create schematics\n• `Utils` - Utility functions\n• `Logger` - Logging functions",
					inline: false,
				}
			)
			.setFooter({ text: "Use !help for more commands" });

		await message.reply({ embeds: [embed] });
		return;
	}

	console.log(
		`✅ Code extracted successfully, length: ${jsCode.length} characters`
	);
	const startTime = Date.now();

	try {
		// Send initial reaction to show processing
		await message.react("⚙️");
		console.log(`⚙️ Added processing reaction`);

		logger.info(
			`Executing script for user ${message.author.username}: ${jsCode.substring(
				0,
				100
			)}...`
		);

		// Execute the script with hard timeout
		console.log(`🚀 Starting script execution...`);
		const result = await executeScriptWithHardTimeout(jsCode, {}, 8000);
		console.log(`✅ Script execution completed`);

		if (!result.hasSchematic || !Buffer.isBuffer(result.schematic)) {
			throw new Error(
				"Script did not return a valid schematic. Make sure to return `{schematic: schem}` from your function."
			);
		}

		console.log(
			`📦 Valid schematic received, size: ${result.schematic.length} bytes`
		);

		// Generate preview image
		console.log(`🖼️ Generating preview image...`);
		const renderOptions = {
			width: 1280,
			height: 720,
			format: "image/png" as const,
			quality: 0.95,
		};

		const previewResult = await processRender({
			schematicData: result.schematic,
			options: renderOptions,
			type: 'image',
			source: 'discord_script',
			originalFilename: `generated_schematic_${Date.now()}.schem`,
			userId: message.author.id,
			channelId: message.channel.id,
			messageId: message.id,
		});
		const previewImageBuffer = previewResult.outputBuffer;
		console.log(
			`✅ Preview image generated, size: ${previewImageBuffer.length} bytes`
		);

		// Create file attachments
		const schematicAttachment = new AttachmentBuilder(result.schematic, {
			name: `generated_schematic_${Date.now()}.schem`,
		});

		const previewAttachment = new AttachmentBuilder(previewImageBuffer, {
			name: `preview_${Date.now()}.png`,
		});

		const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
		const schematicSizeKB = (result.schematic.length / 1024).toFixed(1);
		const codeLengthChars = jsCode.length;

		console.log(
			`📊 Stats: ${processingTime}s, ${schematicSizeKB}KB, ${codeLengthChars} chars`
		);

		// Create success embed
		const embed = new EmbedBuilder()
			.setColor(0x00ae86)
			.setTitle("🚀 Script Executed Successfully!")
			.setDescription(
				`Your JavaScript code has been executed and generated a schematic.`
			)
			.addFields(
				{
					name: "📄 Code Length",
					value: `${codeLengthChars} characters`,
					inline: true,
				},
				{
					name: "📁 Schematic Size",
					value: `${schematicSizeKB}KB`,
					inline: true,
				},
				{
					name: "⏱️ Execution Time",
					value: `${processingTime}s`,
					inline: true,
				},
				{ name: "🎨 Preview", value: "See image below", inline: true },
				{
					name: "📥 Download",
					value: "Use attached .schem file",
					inline: true,
				},
				{ name: "🛡️ Security", value: "8s timeout protection", inline: true }
			)
			.setImage(`attachment://${previewAttachment.name}`)
			.setFooter({
				text: "Use !help for more commands • Script executed safely in sandbox",
			})
			.setTimestamp();

		// Add action buttons
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(`script_help`)
				.setLabel("📖 Script Help")
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId(`script_examples`)
				.setLabel("💡 Examples")
				.setStyle(ButtonStyle.Secondary)
		);

		console.log(`📤 Sending response...`);
		// Send both files with embed
		await message.reply({
			embeds: [embed],
			files: [schematicAttachment, previewAttachment],
			components: [row],
		});

		// Replace loading reaction with success
		await message.reactions.removeAll();
		await message.react("✅");

		console.log(`✅ Script command completed successfully`);
		logger.info(
			`Successfully executed script for ${message.author.username} in ${processingTime}s`
		);
	} catch (error: any) {
		console.error(`❌ Script execution failed:`, error);
		logger.error(
			`Failed to execute script for ${message.author.username}:`,
			error
		);

		// Replace loading reaction with error
		try {
			await message.reactions.removeAll();
			await message.react("❌");
		} catch (reactionError) {
			console.error(`Failed to update reactions:`, reactionError);
		}

		// Determine error type for better user feedback
		let errorType = "Execution Error";
		let errorDescription = "Your script encountered an error during execution.";

		if (
			error.message?.includes("timeout") ||
			error.message?.includes("killed")
		) {
			errorType = "⏰ Execution Timeout";
			errorDescription =
				"Your script took too long to execute (8 second limit).";
		} else if (error.message?.includes("not return a valid schematic")) {
			errorType = "📄 Invalid Return Value";
			errorDescription = error.message;
		} else if (error.message?.includes("validation failed")) {
			errorType = "⚠️ Code Validation Failed";
			errorDescription = "Your code contains potentially dangerous patterns.";
		} else if (error.message?.includes("Child script not found")) {
			errorType = "🔧 Configuration Error";
			errorDescription =
				"Server configuration issue. Please contact administrator.";
		}

		// Send error embed
		const errorEmbed = new EmbedBuilder()
			.setColor(0xff6b6b)
			.setTitle(`❌ ${errorType}`)
			.setDescription(errorDescription)
			.addFields(
				{
					name: "Error Details",
					value: error.message || "Unknown error",
					inline: false,
				},
				{
					name: "💡 Tips",
					value:
						"• Make sure to return `{schematic: schem}`\n• Use `console.log()` for debugging\n• Check for infinite loops",
					inline: false,
				},
				{
					name: "⏱️ Execution Time",
					value: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
					inline: true,
				}
			)
			.setFooter({
				text: "Use !help for assistance • All code is sandboxed for safety",
			})
			.setTimestamp();

		await message.reply({ embeds: [errorEmbed] });
	}
}

/**
 * Extract JavaScript code from Discord message content
 */
function extractJavaScriptCode(content: string): string | null {
	console.log(
		`🔍 Extracting code from content (${content.length} chars):`,
		content.substring(0, 200) + "..."
	);

	// Remove the command part
	const withoutCommand = content
		.replace(/^!\s*(script|code|js)\s*/i, "")
		.trim();
	console.log(
		`🔧 Content without command (${withoutCommand.length} chars):`,
		withoutCommand.substring(0, 100) + "..."
	);

	// Look for ```js or ```javascript code blocks
	const jsCodeBlockMatch = withoutCommand.match(
		/```(?:js|javascript)\s*([\s\S]*?)```/i
	);
	if (jsCodeBlockMatch) {
		console.log(
			`✅ Found JS code block:`,
			jsCodeBlockMatch[1].substring(0, 100) + "..."
		);
		return jsCodeBlockMatch[1].trim();
	}

	// Look for generic ``` code blocks
	const genericCodeBlockMatch = withoutCommand.match(/```\s*([\s\S]*?)```/);
	if (genericCodeBlockMatch) {
		console.log(
			`✅ Found generic code block:`,
			genericCodeBlockMatch[1].substring(0, 100) + "..."
		);
		return genericCodeBlockMatch[1].trim();
	}

	// Look for inline code
	const inlineCodeMatch = withoutCommand.match(/`([^`]+)`/);
	if (inlineCodeMatch) {
		console.log(`✅ Found inline code:`, inlineCodeMatch[1]);
		return inlineCodeMatch[1].trim();
	}

	// If no code blocks, treat remaining content as code
	if (withoutCommand.length > 0) {
		console.log(
			`✅ Using remaining content as code:`,
			withoutCommand.substring(0, 100) + "..."
		);
		return withoutCommand;
	}

	console.log(`❌ No code found in content`);
	return null;
}

/**
 * Execute script with hard timeout using child process
 */
async function executeScriptWithHardTimeout(
	scriptContent: string,
	inputs: Record<string, any>,
	timeoutMs: number = 8000
): Promise<ScriptExecutionResult> {
	return new Promise((resolve, reject) => {
		// Try both src and dist locations for the child script
		const possiblePaths = [
			join(process.cwd(), "src", "child-executor.mjs"),
			join(process.cwd(), "dist", "child-executor.mjs"),
			join(process.cwd(), "child-executor.mjs"),
		];

		let childScriptPath = "";
		const fs = require("fs");

		for (const path of possiblePaths) {
			if (fs.existsSync(path)) {
				childScriptPath = path;
				break;
			}
		}

		if (!childScriptPath) {
			reject(
				new Error(
					`Child script not found. Please ensure child-executor.mjs exists in src/ directory`
				)
			);
			return;
		}

		// Build complete script with prefix
		const prefix = `
export const io = {
  inputs: {},
  outputs: {
    message: { type: 'string' },
    schematic: { type: 'object' }
  }
};
export default async function({ }, { Schematic, Utils, Logger }) {`;

		const completeScript = prefix + scriptContent + `}`;

		// Spawn child process
		const child: ChildProcess = spawn(
			"bun",
			[
				childScriptPath,
				completeScript,
				JSON.stringify(inputs),
				(timeoutMs - 500).toString(),
			],
			{
				stdio: ["pipe", "pipe", "pipe", "ipc"],
				cwd: process.cwd(),
			}
		);

		let isResolved = false;

		// Hard timeout
		const killTimer = setTimeout(() => {
			if (!isResolved) {
				isResolved = true;
				child.kill("SIGKILL");
				reject(new Error(`Script execution timeout after ${timeoutMs}ms`));
			}
		}, timeoutMs + 200);

		// Handle messages from child
		child.on("message", (message) => {
			const typedMessage = message as ChildProcessMessage;

			if (!isResolved) {
				isResolved = true;
				clearTimeout(killTimer);

				if (typedMessage.success && typedMessage.result) {
					// Reconstruct schematic if needed
					if (
						typedMessage.result.hasSchematic &&
						typedMessage.result.schematic
					) {
						try {
							typedMessage.result.schematic = Buffer.from(
								typedMessage.result.schematic as string,
								"base64"
							);
						} catch (err) {
							reject(
								new Error("Failed to reconstruct schematic from child process")
							);
							return;
						}
					}
					resolve(typedMessage.result as ScriptExecutionResult);
				} else if (typedMessage.error) {
					reject(new Error(typedMessage.error.message));
				} else {
					reject(new Error("Unknown error in child process"));
				}
			}
		});

		// Handle process termination
		child.on("exit", (code, signal) => {
			if (!isResolved) {
				isResolved = true;
				clearTimeout(killTimer);

				if (signal === "SIGKILL") {
					reject(new Error(`Script execution timeout after ${timeoutMs}ms`));
				} else if (code !== 0) {
					reject(new Error(`Script execution failed with exit code ${code}`));
				} else {
					reject(
						new Error("Script execution completed but no result received")
					);
				}
			}
		});

		// Handle spawn errors
		child.on("error", (error) => {
			if (!isResolved) {
				isResolved = true;
				clearTimeout(killTimer);
				reject(new Error(`Failed to spawn script process: ${error.message}`));
			}
		});
	});
}

/**
 * Handle ping command
 */
async function handlePingCommand(message: any) {
	const embed = new EmbedBuilder()
		.setColor(0x00ae86)
		.setTitle("🏓 Pong!")
		.setDescription("Schemat render service is online and ready!")
		.addFields(
			{ name: "Bot Status", value: "✅ Online", inline: true },
			{ name: "Render Engine", value: "✅ Ready", inline: true },
			{ name: "Script Engine", value: "✅ Ready", inline: true }
		)
		.setTimestamp();

	await message.reply({ embeds: [embed] });
}

/**
 * Handle help command
 */
async function handleHelpCommand(message: any) {
	const embed = new EmbedBuilder()
		.setColor(0x5865f2)
		.setTitle("🔧 Schemat Bot Commands")
		.setDescription(
			"Transform your Minecraft schematics into beautiful renders!"
		)
		.addFields(
			{
				name: "📸 Image Rendering",
				value:
					"• **Drop a schematic** - Auto-render as image\n• **!render** + attachment - Force image render\n• Supports: `.schem`, `.litematic`",
				inline: false,
			},
			{
				name: "🎬 Video Rendering",
				value:
					"• **!video** + attachment - Create rotation animation\n• **!animate** + attachment - Same as !video\n• 6-second smooth rotation at 30fps",
				inline: false,
			},
			{
				name: "🚀 Script Generation",
				value:
					"• **!script** + code block - Generate schematics with JavaScript\n• **!code** + code block - Same as !script\n• Returns both .schem file and preview image",
				inline: false,
			},
			{
				name: "ℹ️ Utility Commands",
				value:
					"• **!ping** - Check bot status\n• **!status** - View render queue\n• **!info** - Technical details\n• **!help** - Show this help",
				inline: false,
			},
			{
				name: "⚠️ Limits",
				value: `• Max file size: ${Math.round(
					MAX_FILE_SIZE / 1024 / 1024
				)}MB\n• Rate limit: ${RATE_LIMIT_MAX} operations per ${
					RATE_LIMIT_WINDOW / 60000
				} minutes\n• Script timeout: 8 seconds`,
				inline: false,
			}
		)
		.setFooter({
			text: "Drop schematic files or use !script with code blocks!",
		})
		.setTimestamp();

	await message.reply({ embeds: [embed] });
}

/**
 * Handle render command (image or video)
 */
async function handleRenderCommand(message: any, type: "image" | "video") {
	if (message.attachments.size === 0) {
		const embed = new EmbedBuilder()
			.setColor(0xff6b6b)
			.setTitle("❌ No File Attached")
			.setDescription(
				`Please attach a schematic file (.schem or .litematic) to render as ${type}.`
			)
			.addFields(
				{
					name: "Supported Formats",
					value: SUPPORTED_FORMATS.join(", "),
					inline: true,
				},
				{
					name: "Max File Size",
					value: `${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB`,
					inline: true,
				}
			);

		await message.reply({ embeds: [embed] });
		return;
	}

	await handleSchematicAttachments(message, type);
}

/**
 * Handle status command
 */
async function handleStatusCommand(message: any) {
	const userLimit = rateLimits.get(message.author.id);
	const remainingUses = userLimit
		? Math.max(0, RATE_LIMIT_MAX - userLimit.count)
		: RATE_LIMIT_MAX;
	const resetTime = userLimit?.resetTime || Date.now();
	const resetIn = Math.max(0, Math.ceil((resetTime - Date.now()) / 1000 / 60));

	const embed = new EmbedBuilder()
		.setColor(0x4f46e5)
		.setTitle("📊 Your Status")
		.addFields(
			{
				name: "Remaining Operations",
				value: `${remainingUses}/${RATE_LIMIT_MAX}`,
				inline: true,
			},
			{
				name: "Reset Time",
				value: resetIn > 0 ? `${resetIn} minutes` : "Now",
				inline: true,
			},
			{
				name: "Available Features",
				value: "Render • Script • Video",
				inline: true,
			}
		)
		.setFooter({
			text: `Rate limit: ${RATE_LIMIT_MAX} operations per ${
				RATE_LIMIT_WINDOW / 60000
			} minutes`,
		})
		.setTimestamp();

	await message.reply({ embeds: [embed] });
}

/**
 * Handle info command
 */
async function handleInfoCommand(message: any) {
	const embed = new EmbedBuilder()
		.setColor(0x8b5cf6)
		.setTitle("🔍 Technical Information")
		.setDescription("Schemat Bot technical specifications and capabilities")
		.addFields(
			{ name: "Render Engine", value: "Three.js + WebGL", inline: true },
			{ name: "Script Engine", value: "Synthase + Bun", inline: true },
			{ name: "Output Quality", value: "1920x1080 (Full HD)", inline: true },
			{ name: "Video Format", value: "WebM (VP8)", inline: true },
			{ name: "Image Format", value: "PNG (Lossless)", inline: true },
			{ name: "Script Timeout", value: "8 seconds", inline: true },
			{ name: "Max Schematic Size", value: "Unlimited blocks", inline: false },
			{
				name: "Supported Games",
				value: "Minecraft Java Edition",
				inline: false,
			},
			{
				name: "Script Features",
				value: "JavaScript execution, WASM schematics, sandboxed environment",
				inline: false,
			}
		)
		.setFooter({ text: "Built with ❤️ for the Minecraft community" })
		.setTimestamp();

	await message.reply({ embeds: [embed] });
}

/**
 * Check rate limits for user
 */
function checkRateLimit(userId: string): boolean {
	const now = Date.now();
	const userLimit = rateLimits.get(userId);

	if (!userLimit || now > userLimit.resetTime) {
		// Reset or create new limit
		rateLimits.set(userId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
		return true;
	}

	if (userLimit.count >= RATE_LIMIT_MAX) {
		return false; // Rate limited
	}

	userLimit.count++;
	rateLimits.set(userId, userLimit);
	return true;
}

/**
 * Get time until rate limit reset
 */
function getRateLimitReset(userId: string): number {
	const userLimit = rateLimits.get(userId);
	if (!userLimit) return 0;

	return Math.max(0, Math.ceil((userLimit.resetTime - Date.now()) / 1000 / 60));
}

/**
 * Validate schematic file
 */
function validateSchematicFile(attachment: any): string | null {
	// Check file extension
	const fileName = attachment.name.toLowerCase();
	const isSupported = SUPPORTED_FORMATS.some((format) =>
		fileName.endsWith(format)
	);

	if (!isSupported) {
		return `Unsupported file format. Please use: ${SUPPORTED_FORMATS.join(
			", "
		)}`;
	}

	// Check file size
	if (attachment.size > MAX_FILE_SIZE) {
		return `File too large. Maximum size: ${Math.round(
			MAX_FILE_SIZE / 1024 / 1024
		)}MB`;
	}

	return null; // Valid
}

/**
 * Handle message attachments and render schematics
 */
async function handleSchematicAttachments(
	message: any,
	type: "image" | "video"
) {
	// Check rate limit first
	if (!checkRateLimit(message.author.id)) {
		const resetTime = getRateLimitReset(message.author.id);
		const embed = new EmbedBuilder()
			.setColor(0xff6b6b)
			.setTitle("⏰ Rate Limited")
			.setDescription(
				`You've reached the render limit. Try again in **${resetTime} minutes**.`
			)
			.addFields(
				{
					name: "Limit",
					value: `${RATE_LIMIT_MAX} renders per ${
						RATE_LIMIT_WINDOW / 60000
					} minutes`,
					inline: true,
				},
				{ name: "Reset Time", value: `${resetTime} minutes`, inline: true }
			);

		await message.reply({ embeds: [embed] });
		return;
	}

	const schematicAttachments = message.attachments.filter((attachment: any) => {
		return validateSchematicFile(attachment) === null;
	});

	if (schematicAttachments.size === 0) {
		// no errors, it's probably not a schematic file and we can ignore it
		return;
	}

	// Process each valid attachment
	for (const [, attachment] of schematicAttachments) {
		if (type === "video") {
			await renderSchematicVideoAttachment(message, attachment);
		} else {
			await renderSchematicImageAttachment(message, attachment);
		}
	}
}

/**
 * Download and render a single schematic attachment as image
 */
async function renderSchematicImageAttachment(message: any, attachment: any) {
	const startTime = Date.now();

	try {
		// Send initial reaction to show we're processing
		await message.react("📸");

		logger.info(
			`Processing image: ${attachment.name} (${attachment.size} bytes)`
		);

		// Download the attachment
		const response = await fetch(attachment.url);
		if (!response.ok) {
			throw new Error(`Failed to download attachment: ${response.statusText}`);
		}

		const schematicBuffer = Buffer.from(await response.arrayBuffer());

		// Set up render options
		const renderOptions = {
			width: 1920,
			height: 1080,
			format: "image/png" as const,
			quality: 0.95,
		};

		// Render the schematic with full tracking
		const result = await processRender({
			schematicData: schematicBuffer,
			options: renderOptions,
			type: 'image',
			source: 'discord',
			originalFilename: attachment.name,
			userId: message.author.id,
			channelId: message.channel.id,
			messageId: message.id,
		});

		const renderedImageBuffer = result.outputBuffer;

		// Create Discord attachment
		const imageAttachment = new AttachmentBuilder(renderedImageBuffer, {
			name: `${attachment.name.replace(/\.[^/.]+$/, "")}_render.png`,
		});

		const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
		const fileSizeMB = (attachment.size / 1024 / 1024).toFixed(1);

		// Create rich embed response
		const embed = new EmbedBuilder()
			.setColor(0x00ae86)
			.setTitle("🎨 Schematic Rendered!")
			.setDescription(
				`Your **${attachment.name}** has been successfully rendered.`
			)
			.addFields(
				{ name: "📁 Original Size", value: `${fileSizeMB}MB`, inline: true },
				{
					name: "⏱️ Processing Time",
					value: `${processingTime}s`,
					inline: true,
				},
				{ name: "📐 Resolution", value: "1920×1080", inline: true }
			)
			.setImage(`attachment://${imageAttachment.name}`)
			.setFooter({
				text: "Use !video for animation • !script for code generation • Click ⚙️ Options to customize",
			})
			.setTimestamp();

		// Add quick actions
		const quickActions = createQuickActionsRow();

		// Send the rendered image
		await message.reply({
			embeds: [embed],
			files: [imageAttachment],
			components: [quickActions],
		});

		// Replace loading reaction with success
		await message.reactions.removeAll();
		await message.react("✅");

		logger.info(
			`Successfully rendered image for ${attachment.name} in ${processingTime}s`
		);
	} catch (error: any) {
		logger.error(`Failed to render image for ${attachment.name}:`, error);

		// Replace loading reaction with error
		await message.reactions.removeAll();
		await message.react("❌");

		// Send error embed
		const errorEmbed = new EmbedBuilder()
			.setColor(0xff6b6b)
			.setTitle("❌ Render Failed")
			.setDescription(`Failed to render **${attachment.name}**`)
			.addFields(
				{
					name: "Error",
					value: error.message || "Unknown error",
					inline: false,
				},
				{
					name: "Supported Formats",
					value: SUPPORTED_FORMATS.join(", "),
					inline: true,
				},
				{
					name: "Need Help?",
					value: "Use `!help` for assistance",
					inline: true,
				}
			)
			.setTimestamp();

		await message.reply({ embeds: [errorEmbed] });
	}
}

/**
 * Download and render a single schematic attachment as video
 */
async function renderSchematicVideoAttachment(message: any, attachment: any) {
	const startTime = Date.now();

	try {
		// Send initial reaction to show we're processing
		await message.react("🎬");

		logger.info(
			`Processing video: ${attachment.name} (${attachment.size} bytes)`
		);

		// Download the attachment
		const response = await fetch(attachment.url);
		if (!response.ok) {
			throw new Error(`Failed to download attachment: ${response.statusText}`);
		}

		const schematicBuffer = Buffer.from(await response.arrayBuffer());

		// Set up video render options
		const videoOptions = {
			duration: 5, // 5 second video
			width: 1280, // 1280px width
			height: 720, // 720px height
			frameRate: 30, // 30fps for smooth rotation
		};

		// Render the video with full tracking
		const result = await processRender({
			schematicData: schematicBuffer,
			options: videoOptions,
			type: 'video',
			source: 'discord',
			originalFilename: attachment.name,
			userId: message.author.id,
			channelId: message.channel.id,
			messageId: message.id,
		});

		const renderedVideoBuffer = result.outputBuffer;

		// Create Discord attachment
		const videoAttachment = new AttachmentBuilder(renderedVideoBuffer, {
			name: `${attachment.name.replace(/\.[^/.]+$/, "")}_animation.webm`,
		});

		const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
		const fileSizeMB = (attachment.size / 1024 / 1024).toFixed(1);
		const outputSizeMB = (renderedVideoBuffer.length / 1024 / 1024).toFixed(1);

		// Create rich embed response
		const embed = new EmbedBuilder()
			.setColor(0x8b5cf6)
			.setTitle("🎬 Animation Complete!")
			.setDescription(
				`Your **${attachment.name}** has been rendered as a smooth rotation video.`
			)
			.addFields(
				{ name: "📁 Original Size", value: `${fileSizeMB}MB`, inline: true },
				{ name: "🎥 Video Size", value: `${outputSizeMB}MB`, inline: true },
				{
					name: "⏱️ Processing Time",
					value: `${processingTime}s`,
					inline: true,
				},
				{
					name: "🎞️ Duration",
					value: `${videoOptions.duration}s`,
					inline: true,
				},
				{
					name: "📐 Resolution",
					value: `${videoOptions.width}×${videoOptions.height}`,
					inline: true,
				},
				{ name: "🔄 Animation", value: "360° rotation", inline: true }
			)
			.setFooter({
				text: "Use !render for static image • !script for code generation • !help for more commands",
			})
			.setTimestamp();

		// Add action buttons
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(`render_image_${attachment.name}`)
				.setLabel("📸 Render Image")
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId(`help_commands`)
				.setLabel("❓ Help")
				.setStyle(ButtonStyle.Secondary)
		);

		// Send the rendered video
		await message.reply({
			embeds: [embed],
			files: [videoAttachment],
			components: [row],
		});

		// Replace loading reaction with success
		await message.reactions.removeAll();
		await message.react("✅");

		logger.info(
			`Successfully rendered video for ${attachment.name} in ${processingTime}s`
		);
	} catch (error: any) {
		// check the lenghth of the error message since it can possible contain the video data
		if (error.message && error.message.length < 1000) {
			logger.error(`Failed to render video for ${attachment.name}:`, error);
		} else {
			logger.error(
				`Failed to render video for ${attachment.name}:`,
				"Error message too long to log"
			);
			// log some details about the error
			logger.error(
				`Error details: ${JSON.stringify({
					name: error.name,
					stack: error.stack,
				})}`
			);
		}

		// Replace loading reaction with error
		await message.reactions.removeAll();
		await message.react("❌");

		// Send error embed
		const errorEmbed = new EmbedBuilder()
			.setColor(0xff6b6b)
			.setTitle("❌ Video Render Failed")
			.setDescription(`Failed to create animation for **${attachment.name}**`)
			.addFields(
				{
					name: "Error",
					value: error.message || "Unknown error",
					inline: false,
				},
				{
					name: "Try Instead",
					value: "Use `!render` for a static image",
					inline: true,
				},
				{
					name: "Need Help?",
					value: "Use `!help` for assistance",
					inline: true,
				}
			)
			.setTimestamp();

		await message.reply({ embeds: [errorEmbed] });
	}
}

/**
 * Handle button interactions
 */
async function handleButtonInteraction(interaction: any) {
	if (interaction.customId === "help_commands") {
		await handleHelpCommand(interaction);
	} else if (interaction.customId === "script_help") {
		await handleScriptHelpButton(interaction);
	} else if (interaction.customId === "script_examples") {
		await handleScriptExamplesButton(interaction);
	}
	// Add more button handlers as needed
}

/**
 * Handle script help button
 */
async function handleScriptHelpButton(interaction: any) {
	const embed = new EmbedBuilder()
		.setColor(0x5865f2)
		.setTitle("📖 Script Help")
		.setDescription(
			"Learn how to write JavaScript code to generate Minecraft schematics!"
		)
		.addFields(
			{
				name: "📝 Basic Syntax",
				value:
					"```js\nconst schem = new Schematic();\nschem.set_block(x, y, z, 'minecraft:stone');\nreturn {schematic: schem};\n```",
				inline: false,
			},
			{
				name: "🧱 Available Blocks",
				value:
					"Use standard Minecraft block IDs:\n• `minecraft:stone`\n• `minecraft:oak_log`\n• `minecraft:diamond_block`\n• `minecraft:redstone_block`",
				inline: false,
			},
			{
				name: "🔧 Available Objects",
				value:
					"• `Schematic` - Create and modify schematics\n• `Utils` - Helper functions (delay, formatNumber, etc.)\n• `Logger` - Logging functions (info, warn, error)",
				inline: false,
			},
			{
				name: "⚠️ Important Notes",
				value:
					"• Always return `{schematic: schem}`\n• 8 second execution limit\n• Infinite loops will be terminated\n• Code runs in secure sandbox",
				inline: false,
			}
		)
		.setFooter({ text: "Use !script examples for code samples" });

	await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * Handle script examples button
 */
async function handleScriptExamplesButton(interaction: any) {
	const embed = new EmbedBuilder()
		.setColor(0x00ae86)
		.setTitle("💡 Script Examples")
		.setDescription("Copy and paste these examples to get started!")
		.addFields(
			{
				name: "🏗️ Simple Tower",
				value:
					"```js\nconst schem = new Schematic();\nfor(let y = 0; y < 10; y++) {\n  schem.set_block(0, y, 0, 'minecraft:stone');\n}\nreturn {schematic: schem};\n```",
				inline: false,
			},
			{
				name: "🏠 Small House",
				value:
					"```js\nconst schem = new Schematic();\n// Floor\nfor(let x = 0; x < 5; x++) {\n  for(let z = 0; z < 5; z++) {\n    schem.set_block(x, 0, z, 'minecraft:oak_planks');\n  }\n}\n// Walls\nfor(let y = 1; y < 4; y++) {\n  for(let x = 0; x < 5; x++) {\n    schem.set_block(x, y, 0, 'minecraft:oak_log');\n    schem.set_block(x, y, 4, 'minecraft:oak_log');\n  }\n  for(let z = 1; z < 4; z++) {\n    schem.set_block(0, y, z, 'minecraft:oak_log');\n    schem.set_block(4, y, z, 'minecraft:oak_log');\n  }\n}\nreturn {schematic: schem};\n```",
				inline: false,
			},
			{
				name: "🌟 Random Pattern",
				value:
					"```js\nconst schem = new Schematic();\nconst blocks = ['minecraft:diamond_block', 'minecraft:gold_block', 'minecraft:emerald_block'];\nfor(let x = 0; x < 10; x++) {\n  for(let z = 0; z < 10; z++) {\n    const randomBlock = blocks[Math.floor(Math.random() * blocks.length)];\n    schem.set_block(x, 0, z, randomBlock);\n  }\n}\nreturn {schematic: schem};\n```",
				inline: false,
			}
		)
		.setFooter({
			text: "Start with these examples and modify them to create your own designs!",
		});

	await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * Safe reply that handles both messages and interactions
 */
async function safeReply(messageOrInteraction: any, content: string | object) {
	try {
		if (messageOrInteraction.replied || messageOrInteraction.deferred) {
			await messageOrInteraction.followUp(content);
		} else if (messageOrInteraction.reply) {
			await messageOrInteraction.reply(content);
		}
	} catch (error) {
		logger.error("Failed to send reply:", error);
	}
}

export function getDiscordClient(): Client | null {
	return client;
}
