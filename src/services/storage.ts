import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../shared/logger.js';
import { statements } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_ROOT = path.join(__dirname, '../../data/storage');
const CACHE_ROOT = path.join(__dirname, '../../data/cache');

// Ensure storage directories exist
async function ensureDirectories() {
  await fs.mkdir(STORAGE_ROOT, { recursive: true });
  await fs.mkdir(CACHE_ROOT, { recursive: true });
}

ensureDirectories().catch(console.error);

/**
 * Calculate SHA-256 hash of a buffer
 */
export function calculateHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Get storage path for a file hash
 * Creates nested directory structure: /ab/cd/abcd1234...
 */
function getHashPath(hash: string, type: 'storage' | 'cache' = 'storage'): string {
  const root = type === 'storage' ? STORAGE_ROOT : CACHE_ROOT;
  const dir = path.join(root, hash.slice(0, 2), hash.slice(2, 4));
  return path.join(dir, hash);
}

/**
 * Store a file with hash-based naming
 */
export async function storeFile(
  buffer: Buffer,
  metadata: {
    originalFilename?: string;
    mimeType?: string;
  }
): Promise<{ hash: string; path: string; size: number }> {
  const hash = calculateHash(buffer);
  const hashPath = getHashPath(hash);
  
  // Check if file already exists
  try {
    await fs.access(hashPath);
    logger.info(`File already cached: ${hash}`);
    
    // Update access count
    statements.updateFileAccess.run(hash);
    
    return {
      hash,
      path: hashPath,
      size: buffer.length,
    };
  } catch {
    // File doesn't exist, store it
  }
  
  // Create directory structure
  await fs.mkdir(path.dirname(hashPath), { recursive: true });
  
  // Write file
  await fs.writeFile(hashPath, buffer);
  
  // Insert into database
  statements.insertFileCache.run(
    hash,
    metadata.originalFilename || null,
    buffer.length,
    hashPath,
    metadata.mimeType || null
  );
  
  logger.info(`Stored file: ${hash} (${buffer.length} bytes)`);
  
  return {
    hash,
    path: hashPath,
    size: buffer.length,
  };
}

/**
 * Retrieve a file by hash
 */
export async function getFile(hash: string): Promise<Buffer | null> {
  const hashPath = getHashPath(hash);
  
  try {
    const buffer = await fs.readFile(hashPath);
    
    // Update access count
    statements.updateFileAccess.run(hash);
    
    return buffer;
  } catch (error) {
    logger.warn(`File not found: ${hash}`);
    return null;
  }
}

/**
 * Store an artifact (rendered output)
 */
export async function storeArtifact(
  renderId: string,
  fileHash: string,
  artifactType: 'image' | 'video' | 'thumbnail',
  buffer: Buffer,
  metadata: {
    mimeType?: string;
    width?: number;
    height?: number;
  }
): Promise<{ id: string; path: string }> {
  const artifactId = `${renderId}-${artifactType}-${Date.now()}`;
  const artifactHash = calculateHash(buffer);
  const artifactPath = getHashPath(artifactHash);
  
  // Create directory and write file
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  await fs.writeFile(artifactPath, buffer);
  
  // Insert into database
  statements.insertArtifact.run(
    artifactId,
    renderId,
    fileHash,
    artifactType,
    artifactPath,
    buffer.length,
    metadata.mimeType || null,
    metadata.width || null,
    metadata.height || null
  );
  
  logger.info(`Stored artifact: ${artifactId} (${artifactType}, ${buffer.length} bytes)`);
  
  return {
    id: artifactId,
    path: artifactPath,
  };
}

/**
 * Get all artifacts for a render
 */
export function getArtifacts(renderId: string) {
  return statements.getArtifactsByRender.all(renderId);
}

/**
 * Get thumbnail for a file hash (latest one)
 */
export function getThumbnail(fileHash: string) {
  return statements.getThumbnailByFileHash.get(fileHash);
}

/**
 * Check if file exists in cache
 */
export async function fileExists(hash: string): Promise<boolean> {
  const hashPath = getHashPath(hash);
  try {
    await fs.access(hashPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file info from database
 */
export function getFileInfo(hash: string) {
  return statements.getFileCache.get(hash);
}

/**
 * Clean up old cached files (LRU-style)
 */
export async function cleanupCache(options: {
  maxAge?: number; // Max age in seconds
  maxSize?: number; // Max total size in bytes
} = {}) {
  // Implementation for cache cleanup
  // This can be expanded based on needs
  logger.info('Cache cleanup initiated');
}

export default {
  storeFile,
  getFile,
  storeArtifact,
  getArtifacts,
  getThumbnail,
  fileExists,
  getFileInfo,
  calculateHash,
  cleanupCache,
};

