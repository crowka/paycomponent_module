// src/lib/payment/utils/logger.ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: any;
}

export class PaymentLogger {
  private level: LogLevel;
  
  constructor(level: LogLevel = 'info', private source?: string) {
    this.level = level;
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      this.log('DEBUG', message, context);
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      this.log('INFO', message, context);
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog('warn')) {
      this.log('WARN', message, context);
    }
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog('error')) {
      this.log('ERROR', message, context);
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.level);
    const targetLevelIndex = levels.indexOf(level);
    return targetLevelIndex >= currentLevelIndex;
  }

  private log(level: string, message: string, context?: LogContext): void {
    const timestamp = new Date().toISOString();
    const source = this.source ? `[${this.source}]` : '';
    const contextStr = context ? this.formatContext(context) : '';
    
    console.log(`[${timestamp}] ${level} ${source}: ${message}${contextStr}`);
  }
  
  private formatContext(context: LogContext): string {
    // Remove sensitive data and format context for logging
    const safeContext = { ...context };
    
    // Sanitize sensitive data
    if (safeContext.paymentMethod) {
      safeContext.paymentMethod = '[REDACTED]';
    }
    
    if (safeContext.details?.number) {
      safeContext.details.number = '[REDACTED]';
    }
    
    if (safeContext.details?.cvc) {
      safeContext.details.cvc = '[REDACTED]';
    }
    
    return ` ${JSON.stringify(safeContext)}`;
  }
}
