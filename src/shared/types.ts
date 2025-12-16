export interface RenderOptions {
  width?: number;
  height?: number;
  format?: 'image/png' | 'image/jpeg';
  quality?: number;
  autoFrame?: boolean;
  isometric?: boolean;
  background?: string;  // hex color or 'transparent'
  framing?: 'tight' | 'medium' | 'wide';
  cameraPath?: 'circular' | 'orbit' | 'static' | 'cinematic';
}


export interface VideoRenderOptions {
  duration?: number;
  width?: number;
  height?: number;
  frameRate?: number;
  isometric?: boolean;
  background?: string;  // hex color or 'transparent'
  framing?: 'tight' | 'medium' | 'wide';
  cameraPath?: 'circular' | 'orbit' | 'static' | 'cinematic';
}

export interface SchematicMetadata {
  name: string;
  size: number;
  dimensions?: {
    width: number;
    height: number;
    length: number;
  };
}

export interface RenderResult {
  buffer: Buffer;
  metadata: SchematicMetadata;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  services: {
    puppeteer: boolean;
    discord: boolean;
    frontend: boolean;
  };
  uptime: number;
  version: string;
}
