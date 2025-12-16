import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { logger } from '../shared/logger.js';

const commands = [
  new SlashCommandBuilder()
    .setName('render')
    .setDescription('Render a schematic file')
    .addAttachmentOption(option =>
      option
        .setName('schematic')
        .setDescription('The schematic file to render (.schem or .litematic)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('view')
        .setDescription('View type')
        .addChoices(
          { name: 'Perspective', value: 'perspective' },
          { name: 'Isometric', value: 'isometric' }
        )
    )
    .addStringOption(option =>
      option
        .setName('background')
        .setDescription('Background color (hex like #2c3e50 or transparent)')
    )
    .addStringOption(option =>
      option
        .setName('framing')
        .setDescription('Camera framing')
        .addChoices(
          { name: 'Tight', value: 'tight' },
          { name: 'Medium', value: 'medium' },
          { name: 'Wide', value: 'wide' }
        )
    )
    .addIntegerOption(option =>
      option
        .setName('width')
        .setDescription('Image width in pixels (256-4096)')
        .setMinValue(256)
        .setMaxValue(4096)
    )
    .addIntegerOption(option =>
      option
        .setName('height')
        .setDescription('Image height in pixels (256-4096)')
        .setMinValue(256)
        .setMaxValue(4096)
    ),

  new SlashCommandBuilder()
    .setName('video')
    .setDescription('Create an animated video of a schematic')
    .addAttachmentOption(option =>
      option
        .setName('schematic')
        .setDescription('The schematic file to render (.schem or .litematic)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('view')
        .setDescription('View type')
        .addChoices(
          { name: 'Perspective', value: 'perspective' },
          { name: 'Isometric', value: 'isometric' }
        )
    )
    .addStringOption(option =>
      option
        .setName('background')
        .setDescription('Background color (hex like #2c3e50 or transparent)')
    )
    .addIntegerOption(option =>
      option
        .setName('duration')
        .setDescription('Video duration in seconds (1-30)')
        .setMinValue(1)
        .setMaxValue(30)
    )
    .addIntegerOption(option =>
      option
        .setName('framerate')
        .setDescription('Video framerate (15-60 fps)')
        .setMinValue(15)
        .setMaxValue(60)
    ),

  new SlashCommandBuilder()
    .setName('options')
    .setDescription('View or modify your render settings')
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View your current render settings')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('reset')
        .setDescription('Reset your render settings to defaults')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Set a specific render option')
        .addStringOption(option =>
          option
            .setName('view')
            .setDescription('View type')
            .addChoices(
              { name: 'Perspective', value: 'perspective' },
              { name: 'Isometric', value: 'isometric' }
            )
        )
        .addStringOption(option =>
          option
            .setName('background')
            .setDescription('Background color (hex like #2c3e50 or transparent)')
        )
        .addStringOption(option =>
          option
            .setName('framing')
            .setDescription('Camera framing')
            .addChoices(
              { name: 'Tight', value: 'tight' },
              { name: 'Medium', value: 'medium' },
              { name: 'Wide', value: 'wide' }
            )
        )
    ),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show help information about the bot'),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if the bot is online'),

  new SlashCommandBuilder()
    .setName('batch')
    .setDescription('Batch render multiple schematics from a zip file')
    .addAttachmentOption(option =>
      option
        .setName('zip')
        .setDescription('A zip file containing .schem or .litematic files')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('view')
        .setDescription('View type for all renders (default: isometric)')
        .addChoices(
          { name: 'Isometric', value: 'isometric' },
          { name: 'Perspective', value: 'perspective' }
        )
    )
    .addStringOption(option =>
      option
        .setName('background')
        .setDescription('Background color (default: transparent)')
        .addChoices(
          { name: 'Transparent', value: 'transparent' },
          { name: 'Dark (#1a1a1a)', value: '#1a1a1a' },
          { name: 'Light (#f0f0f0)', value: '#f0f0f0' },
          { name: 'Blue (#2c3e50)', value: '#2c3e50' }
        )
    )
    .addStringOption(option =>
      option
        .setName('framing')
        .setDescription('Camera framing (default: medium)')
        .addChoices(
          { name: 'Tight', value: 'tight' },
          { name: 'Medium', value: 'medium' },
          { name: 'Wide', value: 'wide' }
        )
    )
    .addIntegerOption(option =>
      option
        .setName('width')
        .setDescription('Image width in pixels (default: 1920)')
        .setMinValue(256)
        .setMaxValue(4096)
    )
    .addIntegerOption(option =>
      option
        .setName('height')
        .setDescription('Image height in pixels (default: 1080)')
        .setMinValue(256)
        .setMaxValue(4096)
    ),
];

/**
 * Register slash commands with Discord
 */
export async function registerSlashCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;

  if (!token || !clientId) {
    logger.warn('Discord token or client ID not provided, skipping slash command registration');
    return;
  }

  try {
    const rest = new REST({ version: '10' }).setToken(token);

    logger.info('Started refreshing application (/) commands...');

    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands.map(cmd => cmd.toJSON()) }
    );

    logger.info('✅ Successfully registered application (/) commands!');
  } catch (error) {
    logger.error('Failed to register slash commands:', error);
  }
}
