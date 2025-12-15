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
      await handleQuickRender(interaction, 'video');
      break;
      
    case 'quick_isometric':
      const current = getUserOptions(userId);
      setUserOptions(userId, { isometric: !current.isometric });
      await interaction.reply({
        content: `✅ Isometric mode: **${!current.isometric ? 'ON' : 'OFF'}**`,
        ephemeral: true,
      });
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
      const color = interaction.fields.getTextInputValue('background_color');
      
      // Validate hex color
      if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
        await interaction.reply({
          content: '❌ Invalid color format. Please use hex format (e.g., #2c3e50)',
          ephemeral: true,
        });
        return;
      }
      
      setUserOptions(userId, { background: color });
      await interaction.reply({
        content: `✅ Background color set to: **${color}**`,
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

export default {
  handleInteraction,
  handleSelectMenu,
  handleButton,
  handleModal,
  showRenderOptions,
};

