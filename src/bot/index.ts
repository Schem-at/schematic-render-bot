import {
	Client,
	GatewayIntentBits,
	Events,
	ActivityType,
	ChatInputCommandInteraction,
	MessageFlags,
	UserContextMenuCommandInteraction,
	MessageContextMenuCommandInteraction,
	ButtonInteraction,
	MessageReaction,
	User as DiscordUser,
	Partials
} from "discord.js";
import { logger } from "../shared/logger.js";
import { commands, menus, registerCommands, syncCommands } from "./command.js";
import {
	render,
	getAttachmentFromCache,
	createRenderActionButtons,
	storeAttachmentUrl,
	RenderCustomOptions,
	addRotationReactions
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
				GatewayIntentBits.GuildMessageReactions,
			],
			partials: [Partials.Message, Partials.Reaction, Partials.User],
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

		client.on(Events.MessageReactionAdd, async (reaction, user) => {
			if (user.bot) return;

			// Handle partials
			if (reaction.partial) {
				try {
					await reaction.fetch();
				} catch (error) {
					logger.error("Failed to fetch partial reaction:", error);
					return;
				}
			}

			// Handle rotation reactions
			const emoji = reaction.emoji.name;
			if (emoji === '↪️' || emoji === '↩️' || emoji === '🔄') {
				try {
					await handleRotationReaction(reaction as MessageReaction, user as DiscordUser);
				} catch (error) {
					logger.error("Error handling rotation reaction:", error);
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
		// Filter out any undefined/null entries before searching
		const command = commands.filter(cmd => cmd && cmd.info).find(cmd => cmd.info.name == interaction.commandName);
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
		// Filter out any undefined/null entries before searching
		const menu = menus.filter(cmd => cmd && cmd.info).find(cmd => cmd.info.name == interaction.commandName);
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

		const response = await interaction.editReply({
			content: `✅ Re-rendered **${cached.name}** with ${description}`,
			files: [result],
			components: buttons
		});

		if (!isVideo) {
			await addRotationReactions(response);
		}

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

async function handleRotationReaction(reaction: MessageReaction, user: DiscordUser) {
	const message = reaction.message;
	if (message.author?.id !== client?.user?.id) return;

	// Find the attachment URL hash from buttons
	const row = message.components[0] as any;
	const buttons = row?.components;
	if (!buttons || buttons.length === 0) return;

	const firstButton = buttons[0] as any;
	const customId = firstButton.customId;
	if (!customId || !customId.startsWith('render_')) return;

	const parts = customId.split('_');
	const urlHash = parts.slice(2).join('_');

	const cached = getAttachmentFromCache(urlHash);
	if (!cached) return;

	// Determine rotation change
	let rotationChange = 0;
	if (reaction.emoji.name === '↪️') rotationChange = 90;
	else if (reaction.emoji.name === '↩️') rotationChange = -90;
	else if (reaction.emoji.name === '🔄') rotationChange = 180;

	if (rotationChange === 0) return;

	// Calculate new rotation
	const currentRotation = cached.rotation || 0;
	const newRotation = (currentRotation + rotationChange) % 360;

	// Update cache
	storeAttachmentUrl(urlHash, cached.url, cached.name, newRotation);

	// Remove user's reaction
	try {
		await reaction.users.remove(user.id);
	} catch (error) {
		logger.warn("Could not remove user reaction:", error);
	}

	// Re-render
	try {
		// Mock attachment
		const mockAttachment = {
			url: cached.url,
			name: cached.name,
			size: 0,
		} as any;

		// Preserve other options if possible (e.g. isometric)
		// We can try to infer isometric from button labels or customIds
		const isIsometric = parts[1] === 'iso';

		const options: RenderCustomOptions = {
			rotation: newRotation,
			isometric: isIsometric
		};

		const result = await render(mockAttachment, false, options);

		const actionButtons = createRenderActionButtons(cached.url, options);

		await message.edit({
			content: `✅ Rotated **${cached.name}** to ${newRotation}°`,
			files: [result],
			components: actionButtons
		});

	} catch (error) {
		logger.error("Failed to rotate schematic via reaction:", error);
	}
}
