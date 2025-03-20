// src/lib/payment/events/database-event.store.ts
import { v4 as uuidv4 } from 'uuid';
import { Pool } from 'pg';
import { StoredEvent, EventStore } from './event.store';
import { DatabaseConnection } from '../database/connection';
import { PaymentLogger } from '../utils/logger';
import { errorHandler, ErrorCode } from '../utils/error';

export class DatabaseEventStore extends EventStore {
  private logger: PaymentLogger;
  private dbPool: Pool;

  constructor(dbConnection?: DatabaseConnection) {
    super();
    this.logger = new PaymentLogger('info', 'DatabaseEventStore');
    
    // Get the database connection
    if (dbConnection) {
      this.dbPool = dbConnection.getPool();
    } else {
      // Use the singleton instance
      this.dbPool = DatabaseConnection.getInstance().getPool();
    }
  }

  async saveEvent(event: Omit<StoredEvent, 'id'>): Promise<StoredEvent> {
    const eventId = uuidv4();
    
    try {
      const query = `
        INSERT INTO events (
          id, type, data, processed, error, retry_count, next_retry_at, timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `;

      const values = [
        eventId,
        event.type,
        JSON.stringify(event.data),
        event.processed || false,
        event.error,
        event.retryCount || 0,
        event.nextRetryAt,
        event.timestamp
      ];

      const result = await this.dbPool.query(query, values);
      const storedEvent = this.mapRowToEvent(result.rows[0]);
      
      this.logger.debug('Event saved', { 
        eventId: storedEvent.id, 
        type: storedEvent.type 
      });
      
      return storedEvent;
    } catch (error) {
      this.logger.error('Failed to save event', { error, type: event.type });
      throw errorHandler.wrapError(
        error,
        'Failed to save event',
        ErrorCode.DATABASE_ERROR,
        { eventType: event.type }
      );
    }
  }

  async getUnprocessedEvents(): Promise<StoredEvent[]> {
    try {
      const now = new Date();
      
      const query = `
        SELECT * FROM events
        WHERE 
          (processed = false AND (next_retry_at IS NULL OR next_retry_at <= $1))
        ORDER BY timestamp ASC
      `;

      const result = await this.dbPool.query(query, [now]);
      
      const events = result.rows.map(row => this.mapRowToEvent(row));
      
      this.logger.debug(`Retrieved ${events.length} unprocessed events`);
      
      return events;
    } catch (error) {
      this.logger.error('Failed to get unprocessed events', { error });
      throw errorHandler.wrapError(
        error,
        'Failed to get unprocessed events',
        ErrorCode.DATABASE_ERROR
      );
    }
  }

  async getEventById(eventId: string): Promise<StoredEvent | undefined> {
    try {
      const query = 'SELECT * FROM events WHERE id = $1';
      const result = await this.dbPool.query(query, [eventId]);
      
      if (result.rows.length === 0) {
        return undefined;
      }
      
      return this.mapRowToEvent(result.rows[0]);
    } catch (error) {
      this.logger.error('Failed to get event by id', { error, eventId });
      throw errorHandler.wrapError(
        error,
        'Failed to get event by id',
        ErrorCode.DATABASE_ERROR,
        { eventId }
      );
    }
  }

  async markAsProcessed(eventId: string): Promise<void> {
    try {
      const query = `
        UPDATE events
        SET 
          processed = true,
          error = NULL,
          retry_count = 0,
          next_retry_at = NULL
        WHERE id = $1
      `;

      await this.dbPool.query(query, [eventId]);
      
      this.logger.debug('Marked event as processed', { eventId });
    } catch (error) {
      this.logger.error('Failed to mark event as processed', { error, eventId });
      throw errorHandler.wrapError(
        error,
        'Failed to mark event as processed',
        ErrorCode.DATABASE_ERROR,
        { eventId }
      );
    }
  }

  async markAsFailed(eventId: string, error: string): Promise<void> {
    try {
      const query = `
        UPDATE events
        SET 
          processed = true,
          error = $2
        WHERE id = $1
      `;

      await this.dbPool.query(query, [eventId, error]);
      
      this.logger.debug('Marked event as failed', { eventId, error });
    } catch (error) {
      this.logger.error('Failed to mark event as failed', { 
        error, 
        eventId 
      });
      throw errorHandler.wrapError(
        error,
        'Failed to mark event as failed',
        ErrorCode.DATABASE_ERROR,
        { eventId }
      );
    }
  }

  async markForRetry(
    eventId: string, 
    retryCount: number, 
    error: string
  ): Promise<void> {
    try {
      // Exponential backoff for retries
      const delayMs = Math.min(
        1000 * Math.pow(2, retryCount - 1), // Exponential: 1s, 2s, 4s, 8s
        60000 // Maximum 1 minute
      );
      
      const nextRetryAt = new Date(Date.now() + delayMs);
      
      const query = `
        UPDATE events
        SET 
          processed = false,
          error = $2,
          retry_count = $3,
          next_retry_at = $4
        WHERE id = $1
      `;

      await this.dbPool.query(query, [
        eventId, 
        error, 
        retryCount, 
        nextRetryAt
      ]);
      
      this.logger.debug('Marked event for retry', { 
        eventId, 
        retryCount, 
        nextRetryAt 
      });
    } catch (error) {
      this.logger.error('Failed to mark event for retry', { 
        error, 
        eventId 
      });
      throw errorHandler.wrapError(
        error,
        'Failed to mark event for retry',
        ErrorCode.DATABASE_ERROR,
        { eventId }
      );
    }
  }

  async resetProcessedFlag(eventId: string): Promise<void> {
    try {
      const query = `
        UPDATE events
        SET 
          processed = false,
          error = NULL,
          retry_count = 0,
          next_retry_at = NULL
        WHERE id = $1
      `;

      await this.dbPool.query(query, [eventId]);
      
      this.logger.debug('Reset processed flag for event', { eventId });
    } catch (error) {
      this.logger.error('Failed to reset processed flag', { 
        error, 
        eventId 
      });
      throw errorHandler.wrapError(
        error,
        'Failed to reset processed flag',
        ErrorCode.DATABASE_ERROR,
        { eventId }
      );
    }
  }

  async getFailedEvents(): Promise<StoredEvent[]> {
    try {
      const query = `
        SELECT * FROM events
        WHERE processed = true AND error IS NOT NULL
        ORDER BY timestamp DESC
      `;

      const result = await this.dbPool.query(query);
      
      return result.rows.map(row => this.mapRowToEvent(row));
    } catch (error) {
      this.logger.error('Failed to get failed events', { error });
      throw errorHandler.wrapError(
        error,
        'Failed to get failed events',
        ErrorCode.DATABASE_ERROR
      );
    }
  }

  async pruneProcessedEvents(olderThan: Date): Promise<number> {
    try {
      const query = `
        DELETE FROM events
        WHERE processed = true AND error IS NULL AND timestamp < $1
        RETURNING id
      `;

      const result = await this.dbPool.query(query, [olderThan]);
      
      const prunedCount = result.rowCount;
      if (prunedCount > 0) {
        this.logger.info(`Pruned ${prunedCount} processed events older than ${olderThan.toISOString()}`);
      }
      
      return prunedCount;
    } catch (error) {
      this.logger.error('Failed to prune processed events', { 
        error, 
        olderThan 
      });
      throw errorHandler.wrapError(
        error,
        'Failed to prune processed events',
        ErrorCode.DATABASE_ERROR
      );
    }
  }

  private mapRowToEvent(row: any): StoredEvent {
    return {
      id: row.id,
      type: row.type,
      data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
      timestamp: new Date(row.timestamp),
      processed: row.processed,
      error: row.error,
      retryCount: row.retry_count,
      nextRetryAt: row.next_retry_at ? new Date(row.next_retry_at) : undefined
    };
  }
}
