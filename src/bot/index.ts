import {
	Client,
	GatewayIntentBits,
	Events,
	ActivityType,
	ChatInputCommandInteraction,
	MessageFlags,
	UserContextMenuCommandInteraction,
	MessageContextMenuCommandInteraction,
	ButtonInteraction
} from "discord.js";
import { logger } from "../shared/logger.js";
import { commands, menus, registerCommands, syncCommands } from "./command.js";
import {
	render,
	getAttachmentFromCache,
	createRenderActionButtons,
	storeAttachmentUrl,
	RenderCustomOptions
} from "./utils/render.js";
import { TimeoutError } from "puppeteer";

let client: Client | null = null;

// Rate limiting: user ID -> { count, resetTime }
const rateLimits = new Map<string, { count: number; resetTime: number; }>();
const RATE_LIMIT_MAX = 5; // 5 renders per 10 minutes
const RATE_LIMIT_WINDOW = 10 * 60 * 1000; // 10 minutes

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

		client.once("clientReady", async () => {
			logger.info(`✅ Discord bot logged in as ${client?.user?.tag}`);

			// Set bot activity
			client?.user?.setActivity('Minecraft schematics | !help', {
				type: ActivityType.Watching
			});

			// Register slash commands
			registerCommands();
			syncCommands();
		});

		client.on("error", (error) => {
			logger.error("Discord bot error:", error);
		});

		client.on(Events.InteractionCreate, async (interaction) => {
			// Handle slash commands
			if (interaction.isChatInputCommand()) {
				handleCommand(interaction);
			}

			// Handle context menus
			if (interaction.isUserContextMenuCommand() || interaction.isMessageContextMenuCommand()) {
				handleMenu(interaction);
			}

			// Handle button interactions
			if (interaction.isButton()) {
				try {
					await handleButtonInteraction(interaction);
				} catch (error) {
					logger.error("Error handling button interaction:", error);
					if (!interaction.replied && !interaction.deferred) {
						await interaction.reply({
							content: "❌ An error occurred while processing your request.",
							flags: MessageFlags.Ephemeral
						});
					}
				}
			}
		});

		await client.login(token);
	} catch (error) {
		logger.error("Failed to initialize Discord bot:", error);
		throw error;
	}
}

async function handleCommand(interaction: ChatInputCommandInteraction) {
	try {
		const command = commands.find(cmd => cmd.info.name == interaction.commandName);
		if (command == null) {
			await interaction.reply({
				content: `❌ Error: Command \`${interaction.commandName}\` not found.`,
				flags: MessageFlags.Ephemeral
			});
		} else {
			try {
				await command.handle(interaction);
			} catch (error) {
				logger.error("Failed to handle command", error);
			}
		}
	} catch (error) {
		logger.error("Error handling slash command:", error);
	}
}

async function handleMenu(interaction: UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction) {
	try {
		const menu = menus.find(cmd => cmd.info.name == interaction.commandName);
		if (menu == null) {
			try {
				await interaction.reply({
					content: `❌ Error: Command \`${interaction.commandName}\` not found.`,
					flags: MessageFlags.Ephemeral
				});
			} catch (replyError) {
				logger.error("Failed to reply for missing menu command:", replyError);
			}
		} else {
			try {
				await menu.handle(interaction);
			} catch (error) {
				logger.error("Failed to handle menu", error);
				// Try to provide user feedback if interaction hasn't been handled
				try {
					if (!interaction.replied && !interaction.deferred) {
						await interaction.reply({
							content: "❌ An error occurred while processing your request.",
							flags: MessageFlags.Ephemeral
						});
					} else if (interaction.deferred && !interaction.replied) {
						await interaction.editReply({
							content: "❌ An error occurred while processing your request."
						});
					}
				} catch (feedbackError) {
					logger.error("Failed to send error feedback to user:", feedbackError);
				}
			}
		}
	} catch (error) {
		logger.error("Error handling context menu:", error);
		// Last resort: try to provide feedback
		try {
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content: "❌ An error occurred while processing your request.",
					flags: MessageFlags.Ephemeral
				});
			}
		} catch (feedbackError) {
			logger.error("Failed to send error feedback (last resort):", feedbackError);
		}
	}
}

async function handleButtonInteraction(interaction: ButtonInteraction) {
	const customId = interaction.customId;

	// Parse button action and URL hash
	const parts = customId.split('_');
	if (parts.length < 3 || parts[0] !== 'render') {
		logger.warn(`Unknown button customId: ${customId}`);
		return;
	}

	const action = parts[1];
	const urlHash = parts.slice(2).join('_');

	// Retrieve attachment from cache
	const cached = getAttachmentFromCache(urlHash);
	if (!cached) {
		await interaction.reply({
			content: "❌ This render has expired. Please upload the schematic again.",
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	// Determine render options based on button action
	const options: RenderCustomOptions = {};
	let isVideo = false;
	let description = "";

	switch (action) {
		case 'iso':
			options.isometric = true;
			description = "🏛️ Isometric view";
			break;
		case 'persp':
			options.isometric = false;
			description = "📐 Perspective view";
			break;
		case 'video':
			isVideo = true;
			description = "🎬 360° video";
			break;
		case 'bg':
			const bgType = parts[2];
			if (bgType === 'transparent') {
				options.background = 'transparent';
				description = "☁️ Transparent background";
			} else if (bgType === 'dark') {
				options.background = '#1a1a1a';
				description = "🌑 Dark background";
			} else if (bgType === 'light') {
				options.background = '#f0f0f0';
				description = "☀️ Light background";
			}
			break;
		case 'hd':
			options.width = 3840;
			options.height = 2160;
			description = "✨ 4K render";
			break;
		default:
			await interaction.reply({
				content: "❌ Unknown render action.",
				flags: MessageFlags.Ephemeral
			});
			return;
	}

	// Acknowledge the interaction
	await interaction.deferReply();

	try {
		// Create a mock attachment object
		const mockAttachment = {
			url: cached.url,
			name: cached.name,
			size: 0, // Not needed for render
		} as any;

		// Render with new options
		const result = await render(mockAttachment, isVideo, options);

		// Update buttons to reflect current state
		const buttons = createRenderActionButtons(cached.url, options);

		await interaction.editReply({
			content: `✅ Re-rendered **${cached.name}** with ${description}`,
			files: [result],
			components: buttons
		});

		logger.info(`Button render completed: ${description} for ${cached.name}`);

	} catch (error) {
		logger.error(`Button render failed:`, error);

		if (error instanceof TimeoutError) {
			await interaction.editReply({
				content: "⌛ Render took too long. Try with lower quality settings or a smaller schematic."
			});
		} else {
			await interaction.editReply({
				content: `❌ Failed to render: ${error instanceof Error ? error.message : 'Unknown error'}`
			});
		}
	}
}

export function getDiscordClient(): Client | null {
	return client;
}
