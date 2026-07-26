/**
 * Winston logger. Writes structured JSON to rotating files and (optionally)
 * a human-friendly stream to the console.
 */
import path from 'node:path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { config } from '../config';
import { ensureDir } from '../config/env';

ensureDir(config.logging.dir);

const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: false }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level}: ${stack ?? message}${extra}`;
  }),
);

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const transports: winston.transport[] = [
  new DailyRotateFile({
    dirname: config.logging.dir,
    filename: 'app-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxFiles: config.logging.maxFiles,
    zippedArchive: true,
    format: fileFormat,
  }),
  new DailyRotateFile({
    dirname: config.logging.dir,
    filename: 'error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxFiles: config.logging.maxFiles,
    zippedArchive: true,
    format: fileFormat,
  }),
];

if (config.logging.toConsole) {
  transports.push(new winston.transports.Console({ format: consoleFormat }));
}

export const logger = winston.createLogger({
  level: config.isTest ? 'error' : config.logging.level,
  levels: winston.config.npm.levels,
  defaultMeta: { service: 'whatsapp-group-assistant' },
  transports,
  exitOnError: false,
  silent: config.isTest,
});

/** Returns a child logger tagged with a module name. */
export function childLogger(module: string): winston.Logger {
  return logger.child({ module });
}

export const logFilePath = (name: string) => path.join(config.logging.dir, name);
