export type LogData = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, data?: LogData): void;
  info(message: string, data?: LogData): void;
  warn(message: string, data?: LogData): void;
  error(message: string, data?: LogData): void;
}

/** Logs through `console`. The default. */
export const consoleLogger: Logger = {
  debug: (message, data) => (data === undefined ? console.debug(message) : console.debug(message, data)),
  info: (message, data) => (data === undefined ? console.info(message) : console.info(message, data)),
  warn: (message, data) => (data === undefined ? console.warn(message) : console.warn(message, data)),
  error: (message, data) => (data === undefined ? console.error(message) : console.error(message, data)),
};

/** Discards everything. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
