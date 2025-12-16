import {
  Interaction,
  AttachmentBuilder,
  EmbedBuilder,
} from 'discord.js';
import { logger } from '../shared/logger.js';
import { processRender } from '../services/render-service.js';
import {
  getUserOptions,
  setUserOptions,
  getLastSchematic,
  createRenderOptionsMenu,
  createOptionsEmbed,
  createBackgroundModal,
  createAdvancedOptionsModal,
  createQuickActionsRow,
  DEFAULT_OPTIONS,
} from './render-options.js';

/**
 * Main interaction handler
 */
export async function handleInteraction(interaction: Interaction) {
  try {
    if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    } else if (interaction.isModalSubmit()) {
      await handleModal(interaction);
    }
  } catch (error) {
    logger.error('Error handling interaction:', error);

    // Try to respond with error
    try {
      if (interaction.isRepliable() && !interaction.replied) {
        await interaction.reply({
          content: '❌ An error occurred while processing your request.',
          ephemeral: true,
        });
      }
    } catch (replyError) {
      logger.error('Failed to send error reply:', replyError);
    }
  }
}

/**
 * Handle select menu interactions
 */
async function handleSelectMenu(interaction: any) {
  const userId = interaction.user.id;
  const value = interaction.values[0];

  switch (interaction.customId) {
    case 'render_view_type':
      setUserOptions(userId, { isometric: value === 'isometric' });
      await interaction.reply({
        content: `✅ View type set to: **${value === 'isometric' ? 'Isometric' : 'Perspective'}**`,
        ephemeral: true,
      });
      break;

    case 'render_camera_path':
      setUserOptions(userId, { cameraPath: value as any });
      await interaction.reply({
        content: `✅ Camera path set to: **${value}**`,
        ephemeral: true,
      });
      break;

    case 'render_framing':
      setUserOptions(userId, { framing: value as any });
      await interaction.reply({
        content: `✅ Framing set to: **${value}**`,
        ephemeral: true,
      });
      break;

    default:
      await interaction.reply({
        content: '❌ Unknown select menu',
        ephemeral: true,
      });
  }
}

/**
 * Handle button interactions
 */
async function handleButton(interaction: any) {
  const userId = interaction.user.id;

  switch (interaction.customId) {
    case 'show_options':
      await showRenderOptions(interaction, userId);
      break;

    case 'render_set_background':
      await interaction.showModal(createBackgroundModal());
      break;

    case 'render_advanced_options':
      await interaction.showModal(createAdvancedOptionsModal(userId));
      break;

    case 'render_reset_options':
      setUserOptions(userId, { ...DEFAULT_OPTIONS });
      await interaction.reply({
        content: '✅ Render options reset to defaults',
        ephemeral: true,
      });
      break;

    case 'render_preview':
      const embed = createOptionsEmbed(userId);
      await interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
      break;

    case 'quick_render_image':
      await handleQuickRender(interaction, 'image');
      break;

    case 'quick_render_video':
      await handleQuickVideo(interaction, userId);
      break;

    case 'quick_isometric':
      await handleIsometricToggle(interaction, userId);
      break;

    case 'help_commands':
    case 'script_help':
    case 'script_examples':
      // These are handled in the main bot file
      break;

    default:
      // Check if it's a dynamic button (like render_image_filename)
      if (interaction.customId.startsWith('render_image_')) {
        await interaction.reply({
          content: '📸 To render another image, upload the schematic file with !render command',
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: '❌ Unknown button action',
          ephemeral: true,
        });
      }
  }
}

/**
 * Handle modal submissions
 */
async function handleModal(interaction: any) {
  const userId = interaction.user.id;

  switch (interaction.customId) {
    case 'modal_background':
      const color = interaction.fields.getTextInputValue('background_color').trim();

      // Validate hex color or 'transparent'
      const isTransparent = color.toLowerCase() === 'transparent';
      const isValidHex = /^#[0-9A-Fa-f]{6}$/.test(color);

      if (!isTransparent && !isValidHex) {
        await interaction.reply({
          content: '❌ Invalid color format. Please use hex format (e.g., #2c3e50) or "transparent"',
          ephemeral: true,
        });
        return;
      }

      setUserOptions(userId, { background: isTransparent ? 'transparent' : color });
      await interaction.reply({
        content: `✅ Background set to: **${isTransparent ? 'transparent' : color}**`,
        ephemeral: true,
      });
      break;

    case 'modal_advanced':
      try {
        const width = parseInt(interaction.fields.getTextInputValue('width'));
        const height = parseInt(interaction.fields.getTextInputValue('height'));
        const durationStr = interaction.fields.getTextInputValue('duration');
        const frameRateStr = interaction.fields.getTextInputValue('frameRate');

        // Validate dimensions
        if (width < 256 || width > 4096 || height < 256 || height > 4096) {
          await interaction.reply({
            content: '❌ Width and height must be between 256 and 4096',
            ephemeral: true,
          });
          return;
        }

        const updates: any = { width, height };

        if (durationStr) {
          const duration = parseInt(durationStr);
          if (duration >= 1 && duration <= 30) {
            updates.duration = duration;
          }
        }

        if (frameRateStr) {
          const frameRate = parseInt(frameRateStr);
          if (frameRate >= 15 && frameRate <= 60) {
            updates.frameRate = frameRate;
          }
        }

        setUserOptions(userId, updates);
        await interaction.reply({
          content: `✅ Advanced options updated:\n• Resolution: ${width}x${height}${updates.duration ? `\n• Duration: ${updates.duration}s` : ''}${updates.frameRate ? `\n• Frame Rate: ${updates.frameRate}fps` : ''}`,
          ephemeral: true,
        });
      } catch (error) {
        await interaction.reply({
          content: '❌ Invalid input. Please enter valid numbers.',
          ephemeral: true,
        });
      }
      break;

    default:
      await interaction.reply({
        content: '❌ Unknown modal',
        ephemeral: true,
      });
  }
}

/**
 * Show render options menu
 */
async function showRenderOptions(interaction: any, userId: string) {
  const { viewRow, cameraRow, framingRow, buttonRow } = createRenderOptionsMenu(userId);
  const embed = createOptionsEmbed(userId);

  await interaction.reply({
    embeds: [embed],
    components: [viewRow, cameraRow, framingRow, buttonRow],
    ephemeral: true,
  });
}

/**
 * Handle quick render actions
 */
async function handleQuickRender(interaction: any, type: 'image' | 'video') {
  await interaction.reply({
    content: `📸 To render a ${type}, please upload your schematic file.\n\n**Options:**\n• Drop the file directly in chat (auto-render as image)\n• Use \`!${type === 'video' ? 'video' : 'render'}\` command with attachment\n• Click the **⚙️ Options** button to customize your render`,
    ephemeral: true,
  });
}

/**
 * Handle isometric toggle with re-render
 */
async function handleIsometricToggle(interaction: any, userId: string) {
  // Get last schematic
  const lastSchematic = getLastSchematic(userId);

  if (!lastSchematic) {
    // No cached schematic, just toggle the preference
    const current = getUserOptions(userId);
    setUserOptions(userId, { isometric: !current.isometric });
    await interaction.reply({
      content: `✅ Isometric mode: **${!current.isometric ? 'ON' : 'OFF'}**\n\n💡 Upload a schematic to see it rendered in this mode!`,
      ephemeral: true,
    });
    return;
  }

  // Defer reply since rendering takes time
  await interaction.deferReply();

  try {
    // Toggle isometric setting
    const current = getUserOptions(userId);
    const newIsometric = !current.isometric;
    setUserOptions(userId, { isometric: newIsometric });

    // Get updated options
    const userOptions = getUserOptions(userId);

    // Render with new settings
    const startTime = Date.now();
    const renderOptions = {
      width: userOptions.width,
      height: userOptions.height,
      format: 'image/png' as const,
      quality: 0.95,
      isometric: userOptions.isometric,
      background: userOptions.background,
      framing: userOptions.framing,
      cameraPath: userOptions.cameraPath,
    };

    logger.info(`Re-rendering ${lastSchematic.filename} with isometric: ${newIsometric}`);

    const result = await processRender({
      schematicData: lastSchematic.buffer,
      options: renderOptions,
      type: 'image',
      source: 'discord',
      originalFilename: lastSchematic.filename,
      userId: userId,
      channelId: lastSchematic.channelId,
      messageId: interaction.id,
    });

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);

    // Create Discord attachment
    const imageAttachment = new AttachmentBuilder(result.outputBuffer, {
      name: `${lastSchematic.filename.replace(/\.[^/.]+$/, '')}_${newIsometric ? 'isometric' : 'perspective'}.png`,
    });

    // Create embed
    const embed = new EmbedBuilder()
      .setColor(0x00ae86)
      .setTitle(`🎨 Re-rendered in ${newIsometric ? 'Isometric' : 'Perspective'} View!`)
      .setDescription(`Your **${lastSchematic.filename}** has been re-rendered.`)
      .addFields(
        { name: '👁️ View Mode', value: newIsometric ? 'Isometric' : 'Perspective', inline: true },
        { name: '📐 Resolution', value: `${renderOptions.width}×${renderOptions.height}`, inline: true },
        { name: '⏱️ Time', value: `${processingTime}s`, inline: true },
        { name: '🎨 Background', value: renderOptions.background, inline: true },
        { name: '📏 Framing', value: renderOptions.framing, inline: true },
      )
      .setImage(`attachment://${imageAttachment.name}`)
      .setFooter({ text: 'Click again to toggle back • Use /options to customize' })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      files: [imageAttachment],
      components: [createQuickActionsRow()],
    });

    logger.info(`Successfully re-rendered ${lastSchematic.filename} in ${processingTime}s`);
  } catch (error: any) {
    logger.error(`Failed to re-render schematic:`, error);
    await interaction.editReply({
      content: `❌ Failed to re-render: ${error.message}\n\nTry uploading the schematic again.`,
    });
  }
}

/**
 * Handle quick video with re-render
 */
async function handleQuickVideo(interaction: any, userId: string) {
  // Get last schematic
  const lastSchematic = getLastSchematic(userId);

  if (!lastSchematic) {
    // No cached schematic, prompt to upload
    await interaction.reply({
      content: `📸 To render a video, please upload your schematic file.\n\n**Options:**\n• Drop the file directly in chat (auto-render as image)\n• Use \`!video\` command with attachment\n• Click the **⚙️ Options** button to customize your render`,
      ephemeral: true,
    });
    return;
  }

  // Defer reply since rendering takes time
  await interaction.deferReply();

  try {
    // Get user options
    const userOptions = getUserOptions(userId);

    // Render video with current settings
    const startTime = Date.now();
    const videoOptions = {
      duration: userOptions.duration || 6,
      width: userOptions.width,
      height: userOptions.height,
      frameRate: userOptions.frameRate || 30,
      isometric: userOptions.isometric,
      background: userOptions.background,
      framing: userOptions.framing,
      cameraPath: userOptions.cameraPath,
    };

    logger.info(`Rendering video for ${lastSchematic.filename} with user options`);

    const result = await processRender({
      schematicData: lastSchematic.buffer,
      options: videoOptions,
      type: 'video',
      source: 'discord',
      originalFilename: lastSchematic.filename,
      userId: userId,
      channelId: lastSchematic.channelId,
      messageId: interaction.id,
    });

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const outputSizeMB = (result.outputBuffer.length / 1024 / 1024).toFixed(1);

    // Create Discord attachment
    const videoAttachment = new AttachmentBuilder(result.outputBuffer, {
      name: `${lastSchematic.filename.replace(/\.[^/.]+$/, '')}_animation.webm`,
    });

    // Create embed
    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle('🎬 Animation Complete!')
      .setDescription(`Your **${lastSchematic.filename}** has been rendered as a video.`)
      .addFields(
        { name: '🎥 Size', value: `${outputSizeMB}MB`, inline: true },
        { name: '🎞️ Duration', value: `${videoOptions.duration}s`, inline: true },
        { name: '⏱️ Time', value: `${processingTime}s`, inline: true },
        { name: '📐 Resolution', value: `${videoOptions.width}×${videoOptions.height}`, inline: true },
        { name: '👁️ View', value: videoOptions.isometric ? 'Isometric' : 'Perspective', inline: true },
        { name: '📊 FPS', value: `${videoOptions.frameRate}`, inline: true },
        { name: '🎨 Background', value: videoOptions.background, inline: true },
        { name: '📏 Framing', value: videoOptions.framing, inline: true },
      )
      .setFooter({ text: 'Use buttons below to render with different settings' })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      files: [videoAttachment],
      components: [createQuickActionsRow()],
    });

    logger.info(`Successfully rendered video for ${lastSchematic.filename} in ${processingTime}s`);
  } catch (error: any) {
    logger.error(`Failed to render video:`, error);
    await interaction.editReply({
      content: `❌ Failed to render video: ${error.message}\n\nTry uploading the schematic again.`,
    });
  }
}

export default {
  handleInteraction,
  handleSelectMenu,
  handleButton,
  handleModal,
  showRenderOptions,
};

