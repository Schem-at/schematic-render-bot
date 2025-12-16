import { 
	Client, 
	GatewayIntentBits, 
	Events, 
	ActivityType, 
	ChatInputCommandInteraction, 
	MessageFlags, 
	UserContextMenuCommandInteraction, 
	MessageContextMenuCommandInteraction 
} from "discord.js";
import { logger } from "../shared/logger.js";
import { commands, menus, registerCommands, syncCommands } from "./command.js";

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
					// TODO: Buttons
				} catch (error) {
					logger.error("Error handling button interaction:", error);
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
			await interaction.reply({
				content: `❌ Error: Command \`${interaction.commandName}\` not found.`,
				flags: MessageFlags.Ephemeral
			});
		} else {
			try {
				await menu.handle(interaction);
			} catch (error) {
				logger.error("Failed to handle menu", error);
			}
		}
	} catch (error) {
		logger.error("Error handling context menu:", error);
	}
}

export function getDiscordClient(): Client | null {
	return client;
}
