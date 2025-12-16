import { ChatInputCommandInteraction, ContextMenuCommandBuilder, MessageContextMenuCommandInteraction, REST, RESTGetAPIApplicationCommandsResult, Routes, SharedSlashCommand, SlashCommandBuilder, UserContextMenuCommandInteraction } from "discord.js";
import fs from "fs";
import path from "path";
import { logger } from "../shared/logger";
import Reload from "./commands/reload";

export const commands: ICommand[] = new Array();
export const menus: IMenuCommand[] = new Array();

export interface ICommand {
	readonly info: SlashCommandBuilder | SharedSlashCommand;
	handle(interaction: ChatInputCommandInteraction): Promise<void>;
}

export interface IMenuCommand {
	readonly info: ContextMenuCommandBuilder;
	handle(interaction: UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction): Promise<void>;
}

export function registerCommands() {
	// Unregister all commands & menus
	commands.splice(0, commands.length);
	menus.splice(0, menus.length);

	// Find all the commands (support both .ts in dev and .js in production)
	const commandsDirPath = path.join(__dirname, 'commands');
	const commandFiles = fs.readdirSync(commandsDirPath)
		.filter(file => file.endsWith('.ts') || file.endsWith('.js'));

	// Register all the commands
	commandFiles.forEach(file => {
		try {
			const command = require("./" + path.join('commands', file)).default;
			if (command) {
				commands.push(new command());
			} else {
				logger.warn(`Command file ${file} did not export a default class`);
			}
		} catch (error) {
			logger.error(`Failed to load command ${file}:`, error);
		}
	});

	// Find all the context menus (support both .ts in dev and .js in production)
	const menuDirPath = path.join(__dirname, 'menus');
	const menuFiles = fs.readdirSync(menuDirPath)
		.filter(file => file.endsWith('.ts') || file.endsWith('.js'));

	// Register all the menus
	menuFiles.forEach(file => {
		try {
			const menu = require("./" + path.join('menus', file)).default;
			if (menu) {
				const menuInstance = new menu();
				// Validate the menu instance has required properties
				if (menuInstance && menuInstance.info && menuInstance.handle) {
					menus.push(menuInstance);
				} else {
					logger.warn(`Menu file ${file} did not export a valid menu class (missing info or handle)`);
				}
			} else {
				logger.warn(`Menu file ${file} did not export a default class`);
			}
		} catch (error) {
			logger.error(`Failed to load menu ${file}:`, error);
		}
	});

	return [...commands, ...menus];
}

export async function syncCommands() {
	const token = process.env.DISCORD_TOKEN;
	const clientId = process.env.DISCORD_CLIENT_ID;

	if (!token || !clientId) {
		logger.warn("Discord token or client ID not provided, skipping commands synchronization");
		return;
	}

	// Ensure we have the reload command
	if (!commands.some(cmd => cmd instanceof Reload))
		commands.push(new Reload());

	// Filter out any undefined commands/menus and validate
	const validCommands = commands.filter(cmd => cmd && cmd.info);
	const validMenus = menus.filter(menu => menu && menu.info);
	const applications = [...validCommands, ...validMenus];

	if (applications.length === 0) {
		logger.warn("No commands or menus to synchronize");
		return;
	}

	logger.info(`Preparing to sync ${validCommands.length} commands and ${validMenus.length} menus`);

	try {
		const rest = new REST().setToken(token);
		const route = Routes.applicationCommands(clientId);

		// Bulk override of the apps
		// https://discord.com/developers/docs/interactions/application-commands#bulk-overwrite-global-application-commands
		const data = applications.map(app => app.info.toJSON());
		const response = await rest.put(route, { body: data }) as RESTGetAPIApplicationCommandsResult;

		const names = response.map(app => app.name).join(", ");
		logger.info(`✅ Successfully synchronized ${response.length} commands & menus: ${names}`);
	} catch (error) {
		logger.error("Failed to synchronize commands:", error);
		console.error(error);
	}
}