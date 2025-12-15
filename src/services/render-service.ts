import { renderSchematic, renderSchematicVideo } from './renderer.js';
import { storeFile, storeArtifact, calculateHash } from './storage.js';
import { statements } from './database.js';
import { logger } from '../shared/logger.js';
import { RenderOptions, VideoRenderOptions } from '../shared/types.js';
import sharp from 'sharp';

export interface RenderRequest {
  schematicData: Buffer;
  options: RenderOptions | VideoRenderOptions;
  type: 'image' | 'video';
  source?: 'api' | 'discord' | 'discord_script' | 'internal';
  userId?: string;
  channelId?: string;
  messageId?: string;
  originalFilename?: string;
}

export interface RenderResult {
  renderId: string;
  fileHash: string;
  outputBuffer: Buffer;
  artifacts: {
    image?: string;
    video?: string;
    thumbnail?: string;
  };
  metadata: {
    duration: number;
    meshCount?: number;
    size: number;
  };
}

/**
 * Main render service with caching and database integration
 */
export async function processRender(request: RenderRequest): Promise<RenderResult> {
  const startTime = Date.now();
  const renderId = `render-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Calculate file hash
  const fileHash = calculateHash(request.schematicData);
  logger.info(`[${renderId}] Processing render for file: ${fileHash}`);
  
  // Store original schematic file
  await storeFile(request.schematicData, {
    originalFilename: request.originalFilename,
    mimeType: 'application/octet-stream',
  });
  
  // Insert render record
  const format = (request.options as any).format || 'image/png';
  statements.insertRender.run(
    renderId,
    fileHash,
    request.type,
    'running',
    startTime,
    request.schematicData.length,
    request.originalFilename || null,
    request.options.width || 1920,
    request.options.height || 1080,
    format,
    JSON.stringify(request.options),
    request.source || 'api',
    request.userId || null
  );
  
  try {
    let outputBuffer: Buffer;
    let meshCount: number | undefined;
    
    // Perform the actual rendering
    if (request.type === 'image') {
      outputBuffer = await renderSchematic(request.schematicData, request.options as RenderOptions);
    } else {
      outputBuffer = await renderSchematicVideo(request.schematicData, request.options as VideoRenderOptions);
    }
    
    const duration = Date.now() - startTime;
    
    // Store main artifact
    const mainArtifact = await storeArtifact(
      renderId,
      fileHash,
      request.type,
      outputBuffer,
      {
        mimeType: request.type === 'image' ? 'image/png' : 'video/webm',
        width: request.options.width,
        height: request.options.height,
      }
    );
    
    const artifacts: RenderResult['artifacts'] = {};
    
    if (request.type === 'image') {
      artifacts.image = mainArtifact.id;
      
      // Generate thumbnail
      const thumbnailBuffer = await sharp(outputBuffer)
        .resize(400, 300, { fit: 'inside' })
        .png()
        .toBuffer();
      
      const thumbnailArtifact = await storeArtifact(
        renderId,
        fileHash,
        'thumbnail',
        thumbnailBuffer,
        {
          mimeType: 'image/png',
          width: 400,
          height: 300,
        }
      );
      
      artifacts.thumbnail = thumbnailArtifact.id;
    } else {
      artifacts.video = mainArtifact.id;
      
      // For videos, we could extract a frame as thumbnail
      // For now, skip this and implement later when needed
    }
    
    // Update render record with completion
    statements.updateRenderComplete.run(
      Date.now(),
      duration,
      meshCount || null,
      renderId
    );
    
    logger.info(`[${renderId}] ✅ Render completed in ${duration}ms`);
    
    return {
      renderId,
      fileHash,
      outputBuffer,
      artifacts,
      metadata: {
        duration,
        meshCount,
        size: outputBuffer.length,
      },
    };
    
  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    // Update render record with error
    statements.updateRenderError.run(
      Date.now(),
      duration,
      error.message || String(error),
      renderId
    );
    
    logger.error(`[${renderId}] ❌ Render failed:`, error);
    throw error;
  }
}

/**
 * Check if we have a cached render for this file
 */
export function getCachedRender(fileHash: string, options: any) {
  const renders = statements.getRendersByFileHash.all(fileHash) as any[];
  
  // Find a matching completed render with same options
  const cached = renders.find(r => {
    if (r.status !== 'completed') return false;
    
    try {
      const renderOptions = JSON.parse(r.options_json);
      // Simple comparison - could be more sophisticated
      return JSON.stringify(renderOptions) === JSON.stringify(options);
    } catch {
      return false;
    }
  });
  
  return cached;
}

export default {
  processRender,
  getCachedRender,
};

