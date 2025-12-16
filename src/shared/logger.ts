const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] <= LOG_LEVELS[currentLevel];
}

function serializeError(error: any): any {
  if (error instanceof Error) {
    const serialized: any = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
    // Check for cause property (ES2022+)
    if ('cause' in error && error.cause) {
      serialized.cause = serializeError(error.cause);
    }
    return serialized;
  }
  return error;
}

function formatMessage(level: LogLevel, message: string, ...args: any[]): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  if (args.length === 0) {
    return `${prefix} ${message}`;
  }

  // Serialize args, handling Error objects specially
  const serializedArgs = args.map(arg => {
    if (arg instanceof Error) {
      return serializeError(arg);
    }
    // Try to serialize, but handle circular references and non-serializable values
    try {
      return JSON.parse(JSON.stringify(arg, (key, value) => {
        if (value instanceof Error) {
          return serializeError(value);
        }
        // Handle undefined values
        if (value === undefined) {
          return '[undefined]';
        }
        return value;
      }));
    } catch (e) {
      // If serialization fails, return string representation
      return String(arg);
    }
  });

  return `${prefix} ${message} ${JSON.stringify(serializedArgs)}`;
}

export const logger = {
  error: (message: string, ...args: any[]) => {
    if (shouldLog('error')) console.error(formatMessage('error', message, ...args));
  },
  warn: (message: string, ...args: any[]) => {
    if (shouldLog('warn')) console.warn(formatMessage('warn', message, ...args));
  },
  info: (message: string, ...args: any[]) => {
    if (shouldLog('info')) console.info(formatMessage('info', message, ...args));
  },
  debug: (message: string, ...args: any[]) => {
    if (shouldLog('debug')) console.debug(formatMessage('debug', message, ...args));
  },
};
