// Developer: Shadow Coderr, Architect
import * as fs from 'fs-extra';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  private logLevel: LogLevel;
  private logFile: string | undefined;

  constructor(logLevel: LogLevel = LogLevel.INFO, logFile?: string) {
    this.logLevel = logLevel;
    this.logFile = logFile;
  }

  set level(level: LogLevel) {
    this.logLevel = level;
  }

  get level(): LogLevel {
    return this.logLevel;
  }

  debug(message: string, ...args: any[]): void {
    this.log(LogLevel.DEBUG, message, ...args);
  }

  info(message: string, ...args: any[]): void {
    this.log(LogLevel.INFO, message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    this.log(LogLevel.WARN, message, ...args);
  }

  error(message: string, ...args: any[]): void {
    this.log(LogLevel.ERROR, message, ...args);
  }

  private log(level: LogLevel, message: string, ...args: any[]): void {
    if (level < this.logLevel) return;

    const timestamp = new Date().toISOString();
    const levelStr = LogLevel[level];
    const formattedMessage = `[${timestamp}] ${levelStr}: ${message}`;

    console.log(formattedMessage, ...args);

    if (this.logFile) {
      const logEntry = `${formattedMessage} ${args.length ? JSON.stringify(args) : ''}\n`;
      fs.appendFileSync(this.logFile, logEntry);
    }
  }
}

export const logger = new Logger();
