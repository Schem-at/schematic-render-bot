import { ChatInputCommandInteraction, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { logger } from '../shared/logger.js';
import { processRender } from '../services/render-service.js';
import { getUserOptions, setUserOptions, setLastSchematic, createOptionsEmbed, DEFAULT_OPTIONS, createQuickActionsRow } from './render-options.js';

/**
 * Handle slash command interactions
 */
export async function handleSlashCommand(interaction: ChatInputCommandInteraction) {
  const commandName = interaction.commandName;

  try {
    switch (commandName) {
      case 'render':
        await handleRenderCommand(interaction);
        break;
      case 'video':
        await handleVideoCommand(interaction);
        break;
      case 'options':
        await handleOptionsCommand(interaction);
        break;
      case 'help':
        await handleHelpCommand(interaction);
        break;
      case 'ping':
        await handlePingCommand(interaction);
        break;
      default:
        await interaction.reply({
          content: '❌ Unknown command',
          ephemeral: true,
        });
    }
  } catch (error: any) {
    logger.error(`Error handling slash command ${commandName}:`, error);

    const errorMessage = error.message || 'An unexpected error occurred';

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: `❌ Error: ${errorMessage}`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: `❌ Error: ${errorMessage}`,
        ephemeral: true,
      });
    }
  }
}

/**
 * Handle /render command
 */
async function handleRenderCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const attachment = interaction.options.getAttachment('schematic', true);
  const view = interaction.options.getString('view');
  const background = interaction.options.getString('background');
  const framing = interaction.options.getString('framing');
  const width = interaction.options.getInteger('width');
  const height = interaction.options.getInteger('height');

  // Validate file
  if (!attachment.name.endsWith('.schem') && !attachment.name.endsWith('.litematic')) {
    await interaction.editReply('❌ Invalid file type. Please upload a .schem or .litematic file.');
    return;
  }

  if (attachment.size > 25 * 1024 * 1024) {
    await interaction.editReply('❌ File too large. Maximum size is 25MB.');
    return;
  }

  // Download the attachment
  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`Failed to download attachment: ${response.statusText}`);
  }

  const schematicBuffer = Buffer.from(await response.arrayBuffer());

  // Get user's default options and override with command options
  const userOptions = getUserOptions(interaction.user.id);

  const renderOptions = {
    width: width || userOptions.width,
    height: height || userOptions.height,
    format: 'image/png' as const,
    quality: 0.95,
    isometric: view === 'isometric' || (view === null && userOptions.isometric),
    background: background || userOptions.background,
    framing: (framing as any) || userOptions.framing,
  };

  // Validate background color
  if (background) {
    const isTransparent = background.toLowerCase() === 'transparent';
    const isValidHex = /^#[0-9A-Fa-f]{6}$/.test(background);

    if (!isTransparent && !isValidHex) {
      await interaction.editReply('❌ Invalid background color. Use hex format (e.g., #2c3e50) or "transparent"');
      return;
    }
  }

  logger.info(`Slash command render from ${interaction.user.tag}: ${attachment.name}`);

  const startTime = Date.now();

  try {
    // Render the schematic
    const result = await processRender({
      schematicData: schematicBuffer,
      options: renderOptions,
      type: 'image',
      source: 'discord',
      originalFilename: attachment.name,
      userId: interaction.user.id,
      channelId: interaction.channelId,
      messageId: interaction.id,
    });

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);

    // Create Discord attachment
    const imageAttachment = new AttachmentBuilder(result.outputBuffer, {
      name: `${attachment.name.replace(/\.[^/.]+$/, '')}_render.png`,
    });

    // Create embed
    const embed = new EmbedBuilder()
      .setColor(0x00ae86)
      .setTitle('🎨 Schematic Rendered!')
      .setDescription(`Your **${attachment.name}** has been successfully rendered.`)
      .addFields(
        { name: '📐 Resolution', value: `${renderOptions.width}×${renderOptions.height}`, inline: true },
        { name: '👁️ View', value: renderOptions.isometric ? 'Isometric' : 'Perspective', inline: true },
        { name: '⏱️ Time', value: `${processingTime}s`, inline: true },
        { name: '🎨 Background', value: renderOptions.background || '#2c3e50', inline: true },
        { name: '📏 Framing', value: renderOptions.framing || 'medium', inline: true },
      )
      .setImage(`attachment://${imageAttachment.name}`)
      .setFooter({ text: 'Use /video for animation • /options to customize defaults' })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      files: [imageAttachment],
      components: [createQuickActionsRow()],
    });

    logger.info(`Successfully rendered ${attachment.name} in ${processingTime}s`);
  } catch (error: any) {
    logger.error(`Failed to render ${attachment.name}:`, error);
    await interaction.editReply(`❌ Render failed: ${error.message}`);
  }
}

/**
 * Handle /video command
 */
async function handleVideoCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const attachment = interaction.options.getAttachment('schematic', true);
  const view = interaction.options.getString('view');
  const background = interaction.options.getString('background');
  const duration = interaction.options.getInteger('duration');
  const framerate = interaction.options.getInteger('framerate');

  // Validate file
  if (!attachment.name.endsWith('.schem') && !attachment.name.endsWith('.litematic')) {
    await interaction.editReply('❌ Invalid file type. Please upload a .schem or .litematic file.');
    return;
  }

  if (attachment.size > 25 * 1024 * 1024) {
    await interaction.editReply('❌ File too large. Maximum size is 25MB.');
    return;
  }

  // Download the attachment
  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`Failed to download attachment: ${response.statusText}`);
  }

  const schematicBuffer = Buffer.from(await response.arrayBuffer());

  // Cache the schematic for quick re-renders
  setLastSchematic(interaction.user.id, {
    buffer: schematicBuffer,
    filename: attachment.name,
    timestamp: Date.now(),
    channelId: interaction.channelId,
    messageId: interaction.id,
  });

  // Get user's default options and override with command options
  const userOptions = getUserOptions(interaction.user.id);

  const videoOptions = {
    duration: duration || userOptions.duration || 6,
    width: userOptions.width,
    height: userOptions.height,
    frameRate: framerate || userOptions.frameRate || 30,
    isometric: view === 'isometric' || (view === null && userOptions.isometric),
    background: background || userOptions.background,
    framing: userOptions.framing,
    cameraPath: userOptions.cameraPath,
  };

  // Validate background color
  if (background) {
    const isTransparent = background.toLowerCase() === 'transparent';
    const isValidHex = /^#[0-9A-Fa-f]{6}$/.test(background);

    if (!isTransparent && !isValidHex) {
      await interaction.editReply('❌ Invalid background color. Use hex format (e.g., #2c3e50) or "transparent"');
      return;
    }
  }

  logger.info(`Slash command video from ${interaction.user.tag}: ${attachment.name}`);

  const startTime = Date.now();

  try {
    // Render the video
    const result = await processRender({
      schematicData: schematicBuffer,
      options: videoOptions,
      type: 'video',
      source: 'discord',
      originalFilename: attachment.name,
      userId: interaction.user.id,
      channelId: interaction.channelId,
      messageId: interaction.id,
    });

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const outputSizeMB = (result.outputBuffer.length / 1024 / 1024).toFixed(1);

    // Create Discord attachment
    const videoAttachment = new AttachmentBuilder(result.outputBuffer, {
      name: `${attachment.name.replace(/\.[^/.]+$/, '')}_animation.webm`,
    });

    // Create embed
    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle('🎬 Animation Complete!')
      .setDescription(`Your **${attachment.name}** has been rendered as a video.`)
      .addFields(
        { name: '🎥 Size', value: `${outputSizeMB}MB`, inline: true },
        { name: '🎞️ Duration', value: `${videoOptions.duration}s`, inline: true },
        { name: '⏱️ Time', value: `${processingTime}s`, inline: true },
        { name: '📐 Resolution', value: `${videoOptions.width}×${videoOptions.height}`, inline: true },
        { name: '🎨 View', value: videoOptions.isometric ? 'Isometric' : 'Perspective', inline: true },
        { name: '📊 FPS', value: `${videoOptions.frameRate}`, inline: true },
      )
      .setFooter({ text: 'Use /render for static image • /options to customize defaults' })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      files: [videoAttachment],
      components: [createQuickActionsRow()],
    });

    logger.info(`Successfully rendered video ${attachment.name} in ${processingTime}s`);
  } catch (error: any) {
    logger.error(`Failed to render video ${attachment.name}:`, error);
    await interaction.editReply(`❌ Video render failed: ${error.message}`);
  }
}

/**
 * Handle /options command
 */
async function handleOptionsCommand(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();
  const userId = interaction.user.id;

  switch (subcommand) {
    case 'view':
      const embed = createOptionsEmbed(userId);
      await interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
      break;

    case 'reset':
      setUserOptions(userId, { ...DEFAULT_OPTIONS });
      await interaction.reply({
        content: '✅ Your render settings have been reset to defaults',
        ephemeral: true,
      });
      break;

    case 'set':
      const view = interaction.options.getString('view');
      const background = interaction.options.getString('background');
      const framing = interaction.options.getString('framing');

      const updates: any = {};

      if (view) {
        updates.isometric = view === 'isometric';
      }

      if (background) {
        const isTransparent = background.toLowerCase() === 'transparent';
        const isValidHex = /^#[0-9A-Fa-f]{6}$/.test(background);

        if (!isTransparent && !isValidHex) {
          await interaction.reply({
            content: '❌ Invalid background color. Use hex format (e.g., #2c3e50) or "transparent"',
            ephemeral: true,
          });
          return;
        }

        updates.background = isTransparent ? 'transparent' : background;
      }

      if (framing) {
        updates.framing = framing;
      }

      if (Object.keys(updates).length === 0) {
        await interaction.reply({
          content: '❌ Please specify at least one option to set',
          ephemeral: true,
        });
        return;
      }

      setUserOptions(userId, updates);

      const updateMessages = [];
      if (view) updateMessages.push(`View: **${view}**`);
      if (background) updateMessages.push(`Background: **${updates.background}**`);
      if (framing) updateMessages.push(`Framing: **${framing}**`);

      await interaction.reply({
        content: `✅ Settings updated:\n${updateMessages.join('\n')}`,
        ephemeral: true,
      });
      break;
  }
}

/**
 * Handle /help command
 */
async function handleHelpCommand(interaction: ChatInputCommandInteraction) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🔧 Schemat Bot Help')
    .setDescription('Transform your Minecraft schematics into beautiful renders!')
    .addFields(
      {
        name: '📸 /render',
        value: 'Render a schematic as an image with custom settings',
        inline: false,
      },
      {
        name: '🎬 /video',
        value: 'Create an animated video of your schematic',
        inline: false,
      },
      {
        name: '⚙️ /options',
        value: 'View or modify your default render settings',
        inline: false,
      },
      {
        name: '🎨 Customization Options',
        value: '• **View**: Perspective or Isometric\n• **Background**: Any hex color or transparent\n• **Framing**: Tight, Medium, or Wide\n• **Resolution**: Custom width and height\n• **Video**: Custom duration and framerate',
        inline: false,
      },
      {
        name: '💡 Quick Start',
        value: 'Use `/render` with your schematic file, or just drag & drop a file to auto-render!',
        inline: false,
      }
    )
    .setFooter({ text: 'Use /options view to see your current settings' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * Handle /ping command
 */
async function handlePingCommand(interaction: ChatInputCommandInteraction) {
  const embed = new EmbedBuilder()
    .setColor(0x00ae86)
    .setTitle('🏓 Pong!')
    .setDescription('Schemat render service is online and ready!')
    .addFields(
      { name: 'Bot Status', value: '✅ Online', inline: true },
      { name: 'Render Engine', value: '✅ Ready', inline: true },
      { name: 'Script Engine', value: '✅ Ready', inline: true }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
