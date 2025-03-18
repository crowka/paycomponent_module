// src/lib/payment/events/event.processor.ts
import { EventStore, StoredEvent } from './event.store';
import { PaymentLogger } from '../utils/logger';
import { errorHandler, ErrorCode } from '../utils/error';

export class EventProcessor {
  private handlers: Map<string, (data: any) => Promise<void>> = new Map();
  private logger: PaymentLogger;
  private processingInterval: number = 5000; // 5 seconds
  private maxRetries: number = 3;
  private isProcessing: boolean = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private eventStore: EventStore,
    options: {
      processingInterval?: number;
      maxRetries?: number;
    } = {}
  ) {
    this.logger = new PaymentLogger('info', 'EventProcessor');
    this.processingInterval = options.processingInterval || this.processingInterval;
    this.maxRetries = options.maxRetries || this.maxRetries;
  }

  registerHandler(
    eventType: string,
    handler: (data: any) => Promise<void>
  ): void {
    this.handlers.set(eventType, handler);
    this.logger.info(`Registered handler for event: ${eventType}`);
  }

  unregisterHandler(eventType: string): void {
    this.handlers.delete(eventType);
    this.logger.info(`Unregistered handler for event: ${eventType}`);
  }

  async processEvents(): Promise<void> {
    if (this.isProcessing) {
      return; // Already processing
    }

    this.isProcessing = true;
    const operationId = this.generateOperationId();
    
    try {
      this.logger.debug(`[${operationId}] Processing unprocessed events`);
      
      const unprocessedEvents = await this.eventStore.getUnprocessedEvents();
      if (unprocessedEvents.length === 0) {
        this.logger.debug(`[${operationId}] No unprocessed events found`);
        return;
      }
      
      this.logger.info(`[${operationId}] Found ${unprocessedEvents.length} unprocessed events`);
      
      for (const event of unprocessedEvents) {
        await this.processEvent(event, operationId);
      }
    } catch (error) {
      this.logger.error(`[${operationId}] Error processing events`, { error });
    } finally {
      this.isProcessing = false;
    }
  }

  startProcessing(): void {
    if (this.timer) {
      this.stopProcessing();
    }
    
    this.logger.info(`Starting event processor with interval: ${this.processingInterval}ms`);
    
    this.timer = setInterval(() => {
      this.processEvents().catch(error => {
        this.logger.error(`Error in event processing interval`, { error });
      });
    }, this.processingInterval);
  }

  stopProcessing(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info('Stopped event processor');
    }
  }

  private async processEvent(event: StoredEvent, operationId: string): Promise<void> {
    try {
      const handler = this.handlers.get(event.type);
      if (!handler) {
        this.logger.debug(`[${operationId}] No handler for event type: ${event.type}`, { 
          eventId: event.id 
        });
        
        // Mark as processed since we have no handler
        await this.eventStore.markAsProcessed(event.id);
        return;
      }
      
      this.logger.info(`[${operationId}] Processing event: ${event.type}`, { 
        eventId: event.id 
      });
      
      // Execute handler
      await handler(event.data);
      
      // Mark as processed
      await this.eventStore.markAsProcessed(event.id);
      
      this.logger.info(`[${operationId}] Successfully processed event: ${event.type}`, { 
        eventId: event.id 
      });
    } catch (error) {
      // Calculate retry count
      const retryCount = (event.retryCount || 0) + 1;
      
      this.logger.error(`[${operationId}] Error processing event: ${event.type}`, { 
        eventId: event.id, 
        error,
        retryCount
      });
      
      if (retryCount <= this.maxRetries) {
        // Mark for retry
        await this.eventStore.markForRetry(event.id, retryCount, error.message);
        this.logger.info(`[${operationId}] Marked event for retry`, { 
          eventId: event.id, 
          retryCount 
        });
      } else {
        // Mark as failed
        await this.eventStore.markAsFailed(event.id, error.message);
        this.logger.warn(`[${operationId}] Event processing failed after ${retryCount} attempts`, { 
          eventId: event.id, 
          type: event.type 
        });
      }
    }
  }

  private generateOperationId(): string {
    return Math.random().toString(36).substring(2, 10);
  }
}
