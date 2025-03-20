// src/lib/payment/recovery/queue/dead-letter.queue.ts

import { Transaction } from '../../transaction/types';
import { EventEmitter } from '../../events/event.emitter';
import { PaymentLogger } from '../../utils/logger';
import { DatabaseConnection } from '../../database/connection';
import { Pool } from 'pg';

export class DeadLetterQueue {
  private logger: PaymentLogger;
  private eventEmitter?: EventEmitter;
  private dbPool?: Pool;
  private inMemoryQueue: Transaction[] = [];
  private useDatabase: boolean;

  constructor(
    options: {
      eventEmitter?: EventEmitter;
      dbConnection?: DatabaseConnection;
      useDatabase?: boolean;
    } = {}
  ) {
    this.logger = new PaymentLogger('info', 'DeadLetterQueue');
    this.eventEmitter = options.eventEmitter;
    this.useDatabase = options.useDatabase !== false && !!options.dbConnection;
    
    // Initialize database connection if provided
    if (this.useDatabase && options.dbConnection) {
      this.dbPool = options.dbConnection.getPool();
      this.initializeDatabase().catch(error => {
        this.logger.error('Failed to initialize DLQ database table', { error });
        this.useDatabase = false;
      });
    }
  }

  /**
   * Initialize database table for DLQ if it doesn't exist
   */
  private async initializeDatabase(): Promise<void> {
    if (!this.dbPool) return;
    
    try {
      // Create DLQ table if it doesn't exist
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS dead_letter_queue (
          id UUID PRIMARY KEY,
          transaction_id UUID NOT NULL,
          transaction_data JSONB NOT NULL,
          error_code VARCHAR(100),
          error_message TEXT,
          timestamp TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `;
      
      await this.dbPool.query(createTableQuery);
      
      // Create index for efficient lookups
      await this.dbPool.query(`
        CREATE INDEX IF NOT EXISTS idx_dlq_transaction_id 
        ON dead_letter_queue(transaction_id)
      `);
      
      this.logger.info('DLQ database table initialized');
    } catch (error) {
      this.logger.error('Failed to initialize DLQ database table', { error });
      throw error;
    }
  }

  /**
   * Add a transaction to the dead letter queue
   */
  async enqueue(transaction: Transaction): Promise<void> {
    try {
      // Store in database if available
      if (this.useDatabase && this.dbPool) {
        await this.enqueueInDatabase(transaction);
      } else {
        // Fallback to in-memory storage
        this.inMemoryQueue.push({ ...transaction });
      }
      
      this.logger.info(`Transaction ${transaction.id} added to dead letter queue`, {
        status: transaction.status,
        errorCode: transaction.error?.code
      });
      
      // Emit event
      if (this.eventEmitter) {
        await this.eventEmitter.emit('transaction.moved_to_dlq', {
          transactionId: transaction.id,
          status: transaction.status,
          errorCode: transaction.error?.code,
          timestamp: new Date()
        });
      }
    } catch (error) {
      this.logger.error(`Failed to enqueue transaction ${transaction.id} to DLQ`, { error });
      throw error;
    }
  }

  /**
   * Enqueue transaction in database
   */
  private async enqueueInDatabase(transaction: Transaction): Promise<void> {
    if (!this.dbPool) return;
    
    const query = `
      INSERT INTO dead_letter_queue (
        id, 
        transaction_id, 
        transaction_data, 
        error_code, 
        error_message
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO NOTHING
    `;
    
    await this.dbPool.query(query, [
      transaction.id, // Use transaction ID as DLQ entry ID
      transaction.id,
      JSON.stringify(transaction),
      transaction.error?.code,
      transaction.error?.message
    ]);
  }

  /**
   * Get all transactions in the dead letter queue
   */
  async getAll(): Promise<Transaction[]> {
    try {
      if (this.useDatabase && this.dbPool) {
        return this.getAllFromDatabase();
      } else {
        return [...this.inMemoryQueue];
      }
    } catch (error) {
      this.logger.error('Failed to get transactions from DLQ', { error });
      throw error;
    }
  }

  /**
   * Get all transactions from database
   */
  private async getAllFromDatabase(): Promise<Transaction[]> {
    if (!this.dbPool) return [];
    
    const query = `
      SELECT transaction_data 
      FROM dead_letter_queue 
      ORDER BY timestamp DESC
    `;
    
    const result = await this.dbPool.query(query);
    
    return result.rows.map(row => row.transaction_data as Transaction);
  }

  /**
   * Remove a transaction from the dead letter queue
   */
  async remove(transactionId: string): Promise<void> {
    try {
      if (this.useDatabase && this.dbPool) {
        await this.removeFromDatabase(transactionId);
      } else {
        this.inMemoryQueue = this.inMemoryQueue.filter(tx => tx.id !== transactionId);
      }
      
      this.logger.info(`Transaction ${transactionId} removed from dead letter queue`);
      
      // Emit event
      if (this.eventEmitter) {
        await this.eventEmitter.emit('transaction.removed_from_dlq', {
          transactionId,
          timestamp: new Date()
        });
      }
    } catch (error) {
      this.logger.error(`Failed to remove transaction ${transactionId} from DLQ`, { error });
      throw error;
    }
  }

  /**
   * Remove transaction from database
   */
  private async removeFromDatabase(transactionId: string): Promise<void> {
    if (!this.dbPool) return;
    
    const query = `DELETE FROM dead_letter_queue WHERE transaction_id = $1`;
    await this.dbPool.query(query, [transactionId]);
  }

  /**
   * Get a transaction from the dead letter queue by ID
   */
  async get(transactionId: string): Promise<Transaction | null> {
    try {
      if (this.useDatabase && this.dbPool) {
        return this.getFromDatabase(transactionId);
      } else {
        const transaction = this.inMemoryQueue.find(tx => tx.id === transactionId);
        return transaction ? { ...transaction } : null;
      }
    } catch (error) {
      this.logger.error(`Failed to get transaction ${transactionId} from DLQ`, { error });
      throw error;
    }
  }

  /**
   * Get transaction from database
   */
  private async getFromDatabase(transactionId: string): Promise<Transaction | null> {
    if (!this.dbPool) return null;
    
    const query = `
      SELECT transaction_data 
      FROM dead_letter_queue 
      WHERE transaction_id = $1
    `;
    
    const result = await this.dbPool.query(query, [transactionId]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return result.rows[0].transaction_data as Transaction;
  }

  /**
   * Move a transaction from the dead letter queue back for reprocessing
   */
  async reprocess(transactionId: string): Promise<Transaction | null> {
    try {
      // Get the transaction
      const transaction = await this.get(transactionId);
      
      if (!transaction) {
        this.logger.warn(`Transaction ${transactionId} not found in DLQ for reprocessing`);
        return null;
      }
      
      // Remove from queue
      await this.remove(transactionId);
      
      // Emit reprocess event
      if (this.eventEmitter) {
        await this.eventEmitter.emit('transaction.reprocess_from_dlq', {
          transactionId,
          status: transaction.status,
          timestamp: new Date()
        });
      }
      
      return transaction;
    } catch (error) {
      this.logger.error(`Failed to reprocess transaction ${transactionId} from DLQ`, { error });
      throw error;
    }
  }

  /**
   * Get stats about the dead letter queue
   */
  async getStats(): Promise<{
    count: number;
    errorCodes: Record<string, number>;
    oldestTimestamp?: Date;
    newestTimestamp?: Date;
  }> {
    try {
      if (this.useDatabase && this.dbPool) {
        return this.getStatsFromDatabase();
      } else {
        // Generate stats from in-memory queue
        const count = this.inMemoryQueue.length;
        
        // Count transactions by error code
        const errorCodes: Record<string, number> = {};
        this.inMemoryQueue.forEach(tx => {
          const code = tx.error?.code || 'UNKNOWN';
          errorCodes[code] = (errorCodes[code] || 0) + 1;
        });
        
        // Get timestamps
        let oldestTimestamp: Date | undefined;
        let newestTimestamp: Date | undefined;
        
        if (count > 0) {
          const timestamps = this.inMemoryQueue.map(tx => tx.updatedAt || tx.createdAt);
          oldestTimestamp = new Date(Math.min(...timestamps.map(t => t.getTime())));
          newestTimestamp = new Date(Math.max(...timestamps.map(t => t.getTime())));
        }
        
        return {
          count,
          errorCodes,
          oldestTimestamp,
          newestTimestamp
        };
      }
    } catch (error) {
      this.logger.error('Failed to get DLQ stats', { error });
      throw error;
    }
  }

  /**
   * Get stats from database
   */
  private async getStatsFromDatabase(): Promise<{
    count: number;
    errorCodes: Record<string, number>;
    oldestTimestamp?: Date;
    newestTimestamp?: Date;
  }> {
    if (!this.dbPool) {
      return { count: 0, errorCodes: {} };
    }
    
    // Get count
    const countQuery = `SELECT COUNT(*) as count FROM dead_letter_queue`;
    const countResult = await this.dbPool.query(countQuery);
    const count = parseInt(countResult.rows[0].count);
    
    // Get error codes
    const errorCodeQuery = `
      SELECT error_code, COUNT(*) as count 
      FROM dead_letter_queue 
      GROUP BY error_code
    `;
    const errorCodeResult = await this.dbPool.query(errorCodeQuery);
    
    const errorCodes: Record<string, number> = {};
    errorCodeResult.rows.forEach(row => {
      errorCodes[row.error_code || 'UNKNOWN'] = parseInt(row.count);
    });
    
    // Get timestamps
    let oldestTimestamp: Date | undefined;
    let newestTimestamp: Date | undefined;
    
    if (count > 0) {
      const timestampQuery = `
        SELECT 
          MIN(timestamp) as oldest,
          MAX(timestamp) as newest
        FROM dead_letter_queue
      `;
      
      const timestampResult = await this.dbPool.query(timestampQuery);
      
      if (timestampResult.rows[0]) {
        oldestTimestamp = timestampResult.rows[0].oldest;
        newestTimestamp = timestampResult.rows[0].newest;
      }
    }
    
    return {
      count,
      errorCodes,
      oldestTimestamp,
      newestTimestamp
    };
  }

  /**
   * Delete all entries older than a specific date
   */
  async purgeOldEntries(olderThan: Date): Promise<number> {
    try {
      if (this.useDatabase && this.dbPool) {
        return this.purgeOldEntriesFromDatabase(olderThan);
      } else {
        const initialCount = this.inMemoryQueue.length;
        this.inMemoryQueue = this.inMemoryQueue.filter(tx => {
          const timestamp = tx.updatedAt || tx.createdAt;
          return timestamp >= olderThan;
        });
        return initialCount - this.inMemoryQueue.length;
      }
    } catch (error) {
      this.logger.error('Failed to purge old DLQ entries', { error });
      throw error;
    }
  }

  /**
   * Purge old entries from database
   */
  private async purgeOldEntriesFromDatabase(olderThan: Date): Promise<number> {
    if (!this.dbPool) return 0;
    
    const query = `
      DELETE FROM dead_letter_queue 
      WHERE timestamp < $1
      RETURNING id
    `;
    
    const result = await this.dbPool.query(query, [olderThan]);
    return result.rowCount;
  }
}
