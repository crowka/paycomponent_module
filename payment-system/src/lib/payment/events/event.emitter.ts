// src/lib/payment/events/event.emitter.ts
import { EventEmitter as NodeEventEmitter } from 'events';
import { EventStore, StoredEvent } from './event.store';
import { PaymentLogger } from '../utils/logger';
import { errorHandler, ErrorCode } from '../utils/error';

export type EventData = Record<string, any>;
export type EventHandler = (data: EventData) => Promise<void>;
export type EventFilter = (event: string, data: EventData) => boolean;

export class EventEmitter extends NodeEventEmitter {
  private eventStore: EventStore;
  private logger: PaymentLogger;
  private filters: Map<string, EventFilter[]> = new Map();
  private maxRetries: number = 3;

  constructor(eventStore: EventStore) {
    super();
    this.eventStore = eventStore;
    this.logger = new PaymentLogger('info', 'EventEmitter');
    
    // Increase max listeners to avoid warnings
    this.setMaxListeners(100);
  }

  async emit(event: string, data: EventData): Promise<boolean> {
    if (!event || typeof event !== 'string') {
      throw errorHandler.createError(
        'Event name must be a valid string',
        ErrorCode.VALIDATION_ERROR,
        { event }
      );
    }

    const timestamp = new Date();
    const operationId = this.generateOperationId();
    
    try {
      this.logger.info(`[${operationId}] Emitting event: ${event}`, { 
        event, 
        dataKeys: Object.keys(data || {})
      });
      
      // Apply filters
      const shouldEmit = this.applyFilters(event, data);
      if (!shouldEmit) {
        this.logger.debug(`[${operationId}] Event filtered: ${event}`);
        return true; // Return true because filtering is not an error
      }
      
      // Create event with metadata
      const eventWithMeta = {
        ...data,
        _meta: {
          event,
          timestamp,
          operationId
        }
      };
      
      // Store event for reliability
      const storedEvent = await this.eventStore.saveEvent({
        type: event,
        data: eventWithMeta,
        timestamp,
        processed: false
      });
      
      // Emit to synchronous listeners
      let emitted = false;
      try {
        emitted = super.emit(event, eventWithMeta);
        emitted = super.emit('*', event, eventWithMeta) || emitted;
      } catch (error) {
        this.logger.error(`[${operationId}] Error in synchronous listener`, { 
          event, 
          error 
        });
        // Continue even if synchronous listener fails
      }
      
      // Mark as processed even if no listeners, as it's not an error
      if (!emitted) {
        this.logger.debug(`[${operationId}] No listeners for event: ${event}`);
        await this.eventStore.markAsProcessed(storedEvent.id);
      }
      
      return true;
    } catch (error) {
      this.logger.error(`[${operationId}] Failed to emit event: ${event}`, { 
        error, 
        event 
      });
      
      return false;
    }
  }

  async replayEvent(eventId: string): Promise<boolean> {
    try {
      const event = await this.eventStore.getEventById(eventId);
      if (!event) {
        throw errorHandler.createError(
          `Event not found: ${eventId}`,
          ErrorCode.VALIDATION_ERROR,
          { eventId }
        );
      }
      
      this.logger.info(`Replaying event: ${event.type}`, { eventId });
      
      // Reset processed flag
      await this.eventStore.resetProcessedFlag(eventId);
      
      // Re-emit the event
      const emitted = super.emit(event.type, event.data);
      if (!emitted) {
        this.logger.warn(`No listeners for replayed event: ${event.type}`, { eventId });
      }
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to replay event`, { eventId, error });
      return false;
    }
  }

  on(event: string, listener: EventHandler): this {
    super.on(event, async (data) => {
      try {
        await listener(data);
      } catch (error) {
        this.logger.error(`Error in event listener for ${event}`, { error });
        // In a real system, you might want to add retry logic here
      }
    });
    return this;
  }

  addFilter(event: string, filter: EventFilter): void {
    if (!this.filters.has(event)) {
      this.filters.set(event, []);
    }
    this.filters.get(event)!.push(filter);
  }

  removeFilter(event: string, filter: EventFilter): void {
    if (!this.filters.has(event)) {
      return;
    }
    
    const filters = this.filters.get(event)!;
    const index = filters.indexOf(filter);
    if (index !== -1) {
      filters.splice(index, 1);
    }
  }

  private applyFilters(event: string, data: EventData): boolean {
    const filters = this.filters.get(event) || [];
    return filters.every(filter => filter(event, data));
  }

  private generateOperationId(): string {
    return Math.random().toString(36).substring(2, 10);
  }
}
