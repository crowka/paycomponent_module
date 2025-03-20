// src/lib/payment/recovery/queue/retry.queue.ts

import { EventEmitter } from 'events';
import { PaymentLogger } from '../../utils/logger';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseConnection } from '../../database/connection';

interface RetryQueueItem {
  id: string;
  transactionId: string;
  scheduledAt: Date;
  processedAt?: Date;
  retryCount: number;
  status: 'pending' | 'processing' | 'completed' | 'cancelled';
}

/**
 * RetryQueue manages scheduled retries for transactions with persistence
 * and event handling. It can use either in-memory or database storage.
 */
export class RetryQueue extends EventEmitter {
  private inMemoryQueue: Map<string, NodeJS.Timeout> = new Map();
  private logger: PaymentLogger;
  private dbPool?: Pool;
  private useDatabase: boolean;
  private pollInterval: number = 10000; // 10 seconds
  private pollTimer?: NodeJS.Timeout;
  private processing: boolean = false;
  
  constructor(
    options: {
      logLevel?: 'debug' | 'info' | 'warn' | 'error';
      dbConnection?: DatabaseConnection;
      useDatabase?: boolean;
      pollInterval?: number;
    } = {}
  ) {
    super();
    this.logger = new PaymentLogger(options.logLevel || 'info', 'RetryQueue');
    this.useDatabase = options.useDatabase !== false && !!options.dbConnection;
    this.pollInterval = options.pollInterval || 10000;
    
    // Initialize database connection if provided
    if (this.useDatabase && options.dbConnection) {
      this.dbPool = options.dbConnection.getPool();
      this.initializeDatabase().catch(error => {
        this.logger.error('Failed to initialize retry queue database table', { error });
        this.useDatabase = false;
      });
      
      // Start polling for due retries
      this.startPolling();
    }
    
    this.logger.info('Retry queue initialized', {
      useDatabase: this.useDatabase,
      pollInterval: this.pollInterval
    });
  }
  
  /**
   * Initialize database table for retry queue if it doesn't exist
   */
  private async initializeDatabase(): Promise<void> {
    if (!this.dbPool) return;
    
    try {
      // Create retry queue table if it doesn't exist
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS retry_queue (
          id UUID PRIMARY KEY,
          transaction_id UUID NOT NULL,
          scheduled_at TIMESTAMP NOT NULL,
          processed_at TIMESTAMP,
          retry_count INTEGER NOT NULL DEFAULT 0,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `;
      
      await this.dbPool.query(createTableQuery);
      
      // Create indexes for efficient lookups
      await this.dbPool.query(`
        CREATE INDEX IF NOT EXISTS idx_retry_transaction_id 
        ON retry_queue(transaction_id)
      `);
      
      await this.dbPool.query(`
        CREATE INDEX IF NOT EXISTS idx_retry_scheduled_at
        ON retry_queue(scheduled_at) 
        WHERE status = 'pending'
      `);
      
      this.logger.info('Retry queue database table initialized');
    } catch (error) {
      this.logger.error('Failed to initialize retry queue database table', { error });
      throw error;
    }
  }
  
  /**
   * Start polling the database for due retries
   */
  private startPolling(): void {
    if (!this.useDatabase || this.pollTimer) return;
    
    this.pollTimer = setInterval(() => {
      this.processDueRetries().catch(error => {
        this.logger.error('Error processing due retries', { error });
      });
    }, this.pollInterval);
    
    this.logger.info(`Started polling for due retries every ${this.pollInterval}ms`);
  }
  
  /**
   * Stop polling for due retries
   */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
      this.logger.info('Stopped polling for due retries');
    }
  }
  
  /**
   * Process retries that are due to be executed
   */
  private async processDueRetries(): Promise<void> {
    if (!this.dbPool || this.processing) return;
    
    this.processing = true;
    
    try {
      // Get due retries
      const query = `
        SELECT * FROM retry_queue
        WHERE status = 'pending' AND scheduled_at <= NOW()
        ORDER BY scheduled_at ASC
        LIMIT 10
      `;
      
      const result = await this.dbPool.query(query);
      const dueRetries = result.rows;
      
      if (dueRetries.length === 0) {
        return;
      }
      
      this.logger.info(`Processing ${dueRetries.length} due retries`);
      
      // Process each retry
      for (const retry of dueRetries) {
        try {
          // Mark as processing
          await this.dbPool.query(
            `UPDATE retry_queue SET status = 'processing' WHERE id = $1`,
            [retry.id]
          );
          
          // Emit retry event
          this.emit('retry', retry.transaction_id);
          
          // Mark as completed
          await this.dbPool.query(
            `UPDATE retry_queue SET status = 'completed', processed_at = NOW() WHERE id = $1`,
            [retry.id]
          );
          
          this.logger.debug(`Processed retry for transaction ${retry.transaction_id}`);
        } catch (error) {
          this.logger.error(`Error processing retry for transaction ${retry.transaction_id}`, { 
            error,
            retryId: retry.id
          });
          
          // Reset to pending if processing failed
          await this.dbPool.query(
            `UPDATE retry_queue SET status = 'pending' WHERE id = $1`,
            [retry.id]
          );
        }
      }
    } catch (error) {
      this.logger.error('Error querying due retries', { error });
    } finally {
      this.processing = false;
    }
  }
  
  /**
   * Add a transaction to the retry queue with a specified delay
   * @param transactionId ID of the transaction to retry
   * @param delay Delay in milliseconds before the retry should be processed
   */
  async enqueue(
    transactionId: string, 
    delay: number = 0,
    retryCount: number = 0
  ): Promise<void> {
    try {
      // Calculate the scheduled time
      const scheduledAt = new Date(Date.now() + delay);
      
      if (this.useDatabase && this.dbPool) {
        // Store in database
        await this.enqueueInDatabase(transactionId, scheduledAt, retryCount);
      } else {
        // Store in memory
        await this.enqueueInMemory(transactionId, delay);
      }
      
      this.logger.info(`Transaction ${transactionId} scheduled for retry at ${scheduledAt.toISOString()}`, {
        delay,
        retryCount
      });
    } catch (error) {
      this.logger.error(`Failed to enqueue retry for transaction ${transactionId}`, { error });
      throw error;
    }
  }
  
  /**
   * Add a transaction to the in-memory retry queue
   */
  private async enqueueInMemory(transactionId: string, delay: number): Promise<void> {
    // Clear existing timeout if present
    if (this.inMemoryQueue.has(transactionId)) {
      clearTimeout(this.inMemoryQueue.get(transactionId)!);
    }
    
    // Set up new timeout
    const timeout = setTimeout(() => {
      this.emit('retry', transactionId);
      this.inMemoryQueue.delete(transactionId);
    }, delay);
    
    this.inMemoryQueue.set(transactionId, timeout);
  }
  
  /**
   * Add a transaction to the database retry queue
   */
  private async enqueueInDatabase(
    transactionId: string, 
    scheduledAt: Date,
    retryCount: number
  ): Promise<void> {
    if (!this.dbPool) return;
    
    const query = `
      INSERT INTO retry_queue (
        id, transaction_id, scheduled_at, retry_count, status
      )
      VALUES ($1, $2, $3, $4, 'pending')
    `;
    
    await this.dbPool.query(query, [
      uuidv4(),
      transactionId,
      scheduledAt,
      retryCount
    ]);
  }
  
  /**
   * Remove a transaction from the retry queue
   * @param transactionId ID of the transaction to remove
   */
  async dequeue(transactionId: string): Promise<void> {
    try {
      if (this.useDatabase && this.dbPool) {
        await this.dequeueFromDatabase(transactionId);
      } else {
        this.dequeueFromMemory(transactionId);
      }
      
      this.logger.info(`Removed retry for transaction ${transactionId}`);
    } catch (error) {
      this.logger.error(`Failed to dequeue retry for transaction ${transactionId}`, { error });
      throw error;
    }
  }
  
  /**
   * Remove a transaction from the in-memory retry queue
   */
  private dequeueFromMemory(transactionId: string): void {
    const timeout = this.inMemoryQueue.get(transactionId);
    if (timeout) {
      clearTimeout(timeout);
      this.inMemoryQueue.delete(transactionId);
    }
  }
  
  /**
   * Remove a transaction from the database retry queue
   */
  private async dequeueFromDatabase(transactionId: string): Promise<void> {
    if (!this.dbPool) return;
    
    const query = `
      UPDATE retry_queue 
      SET status = 'cancelled'
      WHERE transaction_id = $1 AND status = 'pending'
    `;
    
    await this.dbPool.query(query, [transactionId]);
  }
  
  /**
   * Clear all retries in the queue
   */
  async clear(): Promise<void> {
    try {
      if (this.useDatabase && this.dbPool) {
        await this.clearDatabase();
      } else {
        this.clearMemory();
      }
      
      this.logger.info('Cleared all retries from queue');
    } catch (error) {
      this.logger.error('Failed to clear retry queue', { error });
      throw error;
    }
  }
  
  /**
   * Clear all retries from in-memory queue
   */
  private clearMemory(): void {
    for (const timeout of this.inMemoryQueue.values()) {
      clearTimeout(timeout);
    }
    this.inMemoryQueue.clear();
  }
  
  /**
   * Clear all pending retries from database
   */
  private async clearDatabase(): Promise<void> {
    if (!this.dbPool) return;
    
    const query = `
      UPDATE retry_queue
      SET status = 'cancelled'
      WHERE status = 'pending'
    `;
    
    await this.dbPool.query(query);
  }
  
  /**
   * Get all pending retries
   */
  async getPendingRetries(): Promise<RetryQueueItem[]> {
    try {
      if (this.useDatabase && this.dbPool) {
        return this.getPendingRetriesFromDatabase();
      } else {
        return this.getPendingRetriesFromMemory();
      }
    } catch (error) {
      this.logger.error('Failed to get pending retries', { error });
      throw error;
    }
  }
  
  /**
   * Get pending retries from in-memory queue
   */
  private getPendingRetriesFromMemory(): RetryQueueItem[] {
    return Array.from(this.inMemoryQueue.keys()).map(transactionId => ({
      id: transactionId,
      transactionId,
      scheduledAt: new Date(), // We don't track scheduled time in memory
      retryCount: 0, // We don't track retry count in memory
      status: 'pending'
    }));
  }
  
  /**
   * Get pending retries from database
   */
  private async getPendingRetriesFromDatabase(): Promise<RetryQueueItem[]> {
    if (!this.dbPool) return [];
    
    const query = `
      SELECT id, transaction_id, scheduled_at, retry_count, status
      FROM retry_queue
      WHERE status = 'pending'
      ORDER BY scheduled_at ASC
    `;
    
    const result = await this.dbPool.query(query);
    
    return result.rows.map(row => ({
      id: row.id,
      transactionId: row.transaction_id,
      scheduledAt: row.scheduled_at,
      retryCount: row.retry_count,
      status: row.status
    }));
  }
  
  /**
   * Get statistics about the retry queue
   */
  async getStats(): Promise<{
    pendingCount: number;
    processingCount: number;
    completedCount: number;
    cancelledCount: number;
    oldestPendingRetry?: Date;
    averageRetryTime?: number;
  }> {
    try {
      if (this.useDatabase && this.dbPool) {
        return this.getStatsFromDatabase();
      } else {
        return {
          pendingCount: this.inMemoryQueue.size,
          processingCount: 0,
          completedCount: 0,
          cancelledCount: 0
        };
      }
    } catch (error) {
      this.logger.error('Failed to get retry queue stats', { error });
      throw error;
    }
  }
  
  /**
   * Get statistics from database
   */
  private async getStatsFromDatabase(): Promise<{
    pendingCount: number;
    processingCount: number;
    completedCount: number;
    cancelledCount: number;
    oldestPendingRetry?: Date;
    averageRetryTime?: number;
  }> {
    if (!this.dbPool) {
      return {
        pendingCount: 0,
        processingCount: 0,
        completedCount: 0,
        cancelledCount: 0
      };
    }
    
    // Get counts by status
    const countQuery = `
      SELECT 
        status, 
        COUNT(*) as count
      FROM retry_queue
      GROUP BY status
    `;
    
    const countResult = await this.dbPool.query(countQuery);
    
    const counts = {
      pendingCount: 0,
      processingCount: 0,
      completedCount: 0,
      cancelledCount: 0
    };
    
    for (const row of countResult.rows) {
      switch (row.status) {
        case 'pending':
          counts.pendingCount = parseInt(row.count);
          break;
        case 'processing':
          counts.processingCount = parseInt(row.count);
          break;
        case 'completed':
          counts.completedCount = parseInt(row.count);
          break;
        case 'cancelled':
          counts.cancelledCount = parseInt(row.count);
          break;
      }
    }
    
    // Get oldest pending retry
    const oldestQuery = `
      SELECT MIN(scheduled_at) as oldest
      FROM retry_queue
      WHERE status = 'pending'
    `;
    
    const oldestResult = await this.dbPool.query(oldestQuery);
    const oldestPendingRetry = oldestResult.rows[0]?.oldest;
    
    // Get average retry time for completed items
    const avgTimeQuery = `
      SELECT AVG(EXTRACT(EPOCH FROM (processed_at - scheduled_at)) * 1000) as avg_time
      FROM retry_queue
      WHERE status = 'completed' AND processed_at IS NOT NULL
    `;
    
    const avgTimeResult = await this.dbPool.query(avgTimeQuery);
    const averageRetryTime = avgTimeResult.rows[0]?.avg_time;
    
    return {
      ...counts,
      oldestPendingRetry: oldestPendingRetry ? new Date(oldestPendingRetry) : undefined,
      averageRetryTime: averageRetryTime ? parseFloat(averageRetryTime) : undefined
    };
  }
  
  /**
   * Clean up old completed/cancelled retries
   * @param olderThan Date cutoff for cleanup
   */
  async cleanup(olderThan: Date): Promise<number> {
    if (!this.useDatabase || !this.dbPool) {
      return 0;
    }
    
    try {
      const query = `
        DELETE FROM retry_queue
        WHERE (status = 'completed' OR status = 'cancelled')
        AND scheduled_at < $1
        RETURNING id
      `;
      
      const result = await this.dbPool.query(query, [olderThan]);
      const deletedCount = result.rowCount;
      
      this.logger.info(`Cleaned up ${deletedCount} old retries`);
      return deletedCount;
    } catch (error) {
      this.logger.error('Failed to clean up old retries', { error });
      throw error;
    }
  }
  
  /**
   * Dispose of the retry queue, clearing all timers
   */
  dispose(): void {
    // Stop polling
    this.stopPolling();
    
    // Clear memory queue
    this.clearMemory();
    
    this.logger.info('Retry queue disposed');
  }
