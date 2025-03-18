// src/lib/payment/events/event.store.ts
import { PaymentLogger } from '../utils/logger';
import { errorHandler, ErrorCode } from '../utils/error';

export interface StoredEvent {
  id: string;
  type: string;
  data: any;
  timestamp: Date;
  processed?: boolean;
  error?: string;
  retryCount?: number;
  nextRetryAt?: Date;
}

export class EventStore {
  private events: StoredEvent[] = [];
  private logger: PaymentLogger;
  
  constructor() {
    this.logger = new PaymentLogger('info', 'EventStore');
  }

  async saveEvent(event: Omit<StoredEvent, 'id'>): Promise<StoredEvent> {
    const eventId = this.generateId();
    
    const storedEvent: StoredEvent = {
      id: eventId,
      ...event
    };
    
    this.events.push(storedEvent);
    this.logger.debug(`Saved event: ${event.type}`, { eventId });
    
    return storedEvent;
  }

  async getUnprocessedEvents(): Promise<StoredEvent[]> {
    const now = new Date();
    
    return this.events.filter(event => {
      // Not processed yet
      if (!event.processed) {
        // Check if it's ready for retry
        if (event.nextRetryAt) {
          return now >= event.nextRetryAt;
        }
        return true;
      }
      return false;
    });
  }

  async getEventById(eventId: string): Promise<StoredEvent | undefined> {
    return this.events.find(e => e.id === eventId);
  }

  async markAsProcessed(eventId: string): Promise<void> {
    const event = this.events.find(e => e.id === eventId);
    if (event) {
      event.processed = true;
      event.error = undefined;
      event.retryCount = undefined;
      event.nextRetryAt = undefined;
      this.logger.debug(`Marked event as processed`, { eventId });
    } else {
      this.logger.warn(`Attempted to mark non-existent event as processed`, { eventId });
    }
  }

  async markAsFailed(eventId: string, error: string): Promise<void> {
    const event = this.events.find(e => e.id === eventId);
    if (event) {
      event.processed = true;
      event.error = error;
      this.logger.debug(`Marked event as failed`, { eventId, error });
    } else {
      this.logger.warn(`Attempted to mark non-existent event as failed`, { eventId });
    }
  }

  async markForRetry(
    eventId: string, 
    retryCount: number, 
    error: string
  ): Promise<void> {
    const event = this.events.find(e => e.id === eventId);
    if (event) {
      event.processed = false;
      event.error = error;
      event.retryCount = retryCount;
      
      // Exponential backoff for retries
      const delayMs = Math.min(
        1000 * Math.pow(2, retryCount - 1), // Exponential: 1s, 2s, 4s, 8s
        60000 // Maximum 1 minute
      );
      
      event.nextRetryAt = new Date(Date.now() + delayMs);
      
      this.logger.debug(`Marked event for retry`, { 
        eventId, 
        retryCount, 
        nextRetryAt: event.nextRetryAt 
      });
    } else {
      this.logger.warn(`Attempted to mark non-existent event for retry`, { eventId });
    }
  }

  async resetProcessedFlag(eventId: string): Promise<void> {
    const event = this.events.find(e => e.id === eventId);
    if (event) {
      event.processed = false;
      event.error = undefined;
      event.retryCount = 0;
      event.nextRetryAt = undefined;
      this.logger.debug(`Reset processed flag for event`, { eventId });
    } else {
      this.logger.warn(`Attempted to reset processed flag for non-existent event`, { eventId });
    }
  }

  async getFailedEvents(): Promise<StoredEvent[]> {
    return this.events.filter(event => event.processed && event.error);
  }

  async pruneProcessedEvents(olderThan: Date): Promise<number> {
    const initialCount = this.events.length;
    
    this.events = this.events.filter(event => {
      // Keep if not processed or if processed after the cutoff date
      return !event.processed || event.timestamp > olderThan;
    });
    
    const prunedCount = initialCount - this.events.length;
    if (prunedCount > 0) {
      this.logger.info(`Pruned ${prunedCount} processed events older than ${olderThan.toISOString()}`);
    }
    
    return prunedCount;
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }
}
