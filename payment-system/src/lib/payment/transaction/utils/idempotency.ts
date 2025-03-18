// src/lib/payment/transaction/utils/idempotency.ts
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { PaymentLogger } from '../../utils/logger';
import { errorHandler, ErrorCode } from '../../utils/error';
import { EventEmitter } from '../../events/event.emitter';

export interface IdempotencyRecord {
  key: string;
  locked: boolean;
  timestamp: Date;
  resourceId?: string;
  resourceType?: string;
  expiresAt: Date;
  requestHash?: string;
  attempts: number;
  lastAttemptAt?: Date;
}

export class IdempotencyManager {
  private records: Map<string, IdempotencyRecord> = new Map();
  private logger: PaymentLogger;
  private lockExpirationMs: number;
  private recordExpirationMs: number;
  private eventEmitter?: EventEmitter;

  constructor(
    options: {
      lockExpirationMs?: number;
      recordExpirationMs?: number;
      eventEmitter?: EventEmitter;
    } = {}
  ) {
    this.lockExpirationMs = options.lockExpirationMs || 300000; // 5 minutes default lock expiration
    this.recordExpirationMs = options.recordExpirationMs || 86400000; // 24 hours default record expiration
    this.eventEmitter = options.eventEmitter;
    this.logger = new PaymentLogger('info', 'IdempotencyManager');

    // Setup periodic cleanup
    if (typeof setInterval !== 'undefined') {
      setInterval(() => this.cleanup(), 3600000); // Run cleanup every hour
    }
  }

  /**
   * Check if a key exists and either lock it or return information about the existing operation
   * Includes replay detection based on request body hashing
   */
  async checkAndLock(key: string, requestBody?: any): Promise<boolean> {
    this.validateKey(key);
    
    // First run cleanup
    this.cleanup();

    // Generate request hash if body is provided for replay detection
    const requestHash = requestBody ? this.generateRequestHash(requestBody) : undefined;
    
    // Check if key exists and is still valid
    const existing = this.records.get(key);

    if (existing) {
      this.logger.info('Found existing idempotency record', { 
        key, 
        locked: existing.locked,
        resourceId: existing.resourceId,
        attempts: existing.attempts
      });
      
      // Update attempts counter
      existing.attempts += 1;
      existing.lastAttemptAt = new Date();
      
      // Check for replay attack with different request body
      if (requestHash && existing.requestHash && requestHash !== existing.requestHash) {
        this.logger.warn('Possible replay attack detected: same idempotency key with different request body', {
          key,
          attempts: existing.attempts
        });
        
        // Emit replay detection event
        if (this.eventEmitter) {
          this.eventEmitter.emit('idempotency.replay_detected', {
            key,
            attempts: existing.attempts,
            originalTimestamp: existing.timestamp,
            newTimestamp: new Date()
          }).catch(error => {
            this.logger.error('Failed to emit replay detection event', { error });
          });
        }
        
        throw errorHandler.createError(
          'Request body does not match original request',
          ErrorCode.IDEMPOTENCY_ERROR,
          { idempotencyKey: key }
        );
      }
      
      if (existing.locked) {
        const now = new Date();
        // If lock has expired, we can reset it
        if (now > existing.expiresAt) {
          this.logger.info('Lock expired, resetting', { key });
          existing.locked = true;
          existing.timestamp = now;
          existing.expiresAt = new Date(now.getTime() + this.lockExpirationMs);
          return true;
        }
        
        // Otherwise, it's a duplicate request during processing
        this.logger.warn('Duplicate request while operation in progress', {
          key, 
          lockedAt: existing.timestamp
        });
        
        // Emit duplicate request event
        if (this.eventEmitter) {
          this.eventEmitter.emit('idempotency.duplicate_request', {
            key,
            status: 'in_progress',
            attempts: existing.attempts
          }).catch(error => {
            this.logger.error('Failed to emit duplicate request event', { error });
          });
        }
        
        throw errorHandler.createError(
          'Duplicate request: operation is in progress',
          ErrorCode.DUPLICATE_REQUEST,
          { idempotencyKey: key }
        );
      }
      
      // If we have a completed operation linked to this key
      if (existing.resourceId) {
        this.logger.info('Request with previously completed operation', {
          key,
          resourceId: existing.resourceId
        });
        
        // Emit duplicate request event for completed operation
        if (this.eventEmitter) {
          this.eventEmitter.emit('idempotency.duplicate_request', {
            key,
            status: 'completed',
            resourceId: existing.resourceId,
            attempts: existing.attempts
          }).catch(error => {
            this.logger.error('Failed to emit duplicate request event', { error });
          });
        }
        
        throw errorHandler.createError(
          'Duplicate request: operation already completed',
          ErrorCode.DUPLICATE_REQUEST,
          { 
            idempotencyKey: key,
            resourceId: existing.resourceId,
            resourceType: existing.resourceType
          }
        );
      }
      
      // Otherwise it's unlocked and can be reused
      existing.locked = true;
      existing.timestamp = new Date();
      existing.expiresAt = new Date(Date.now() + this.lockExpirationMs);
      return true;
    }
    
    // Create a new lock
    const now = new Date();
    this.records.set(key, { 
      key,
      locked: true, 
      timestamp: now,
      expiresAt: new Date(now.getTime() + this.lockExpirationMs),
      requestHash,
      attempts: 1,
      lastAttemptAt: now
    });
    
    this.logger.info('Created new idempotency record', { key, requestHash: requestHash ? '[present]' : '[not provided]' });
    
    // Emit new key event
    if (this.eventEmitter) {
      this.eventEmitter.emit('idempotency.key_created', {
        key,
        timestamp: now
      }).catch(error => {
        this.logger.error('Failed to emit key created event', { error });
      });
    }
    
    return true;
  }

  /**
   * Release a lock on a key
   */
  async releaseLock(key: string): Promise<void> {
    this.validateKey(key);
    
    const record = this.records.get(key);
    if (record) {
      record.locked = false;
      this.logger.info('Released idempotency lock', { key });
      
      // Emit lock released event
      if (this.eventEmitter) {
        this.eventEmitter.emit('idempotency.lock_released', {
          key,
          attempts: record.attempts
        }).catch(error => {
          this.logger.error('Failed to emit lock released event', { error });
        });
      }
    } else {
      this.logger.warn('Attempted to release non-existent lock', { key });
    }
  }

  /**
   * Associate a resource with an idempotency key after operation completes
   */
  async associateResource(
    key: string, 
    resourceId: string, 
    resourceType: string
  ): Promise<void> {
    this.validateKey(key);
    
    const record = this.records.get(key);
    if (record) {
      record.resourceId = resourceId;
      record.resourceType = resourceType;
      record.locked = false;
      
      // Extend expiration time since we now have an associated resource
      record.expiresAt = new Date(Date.now() + this.recordExpirationMs);
      
      this.logger.info('Associated resource with idempotency key', { 
        key, 
        resourceId, 
        resourceType 
      });
      
      // Emit resource association event
      if (this.eventEmitter) {
        this.eventEmitter.emit('idempotency.resource_associated', {
          key,
          resourceId,
          resourceType,
          attempts: record.attempts
        }).catch(error => {
          this.logger.error('Failed to emit resource association event', { error });
        });
      }
    } else {
      this.logger.warn('Attempted to associate resource with non-existent key', { 
        key, 
        resourceId, 
        resourceType 
      });
    }
  }

  /**
   * Get resource associated with an idempotency key
   */
  async getAssociatedResource(
    key: string
  ): Promise<{ resourceId: string; resourceType: string } | null> {
    this.validateKey(key);
    
    const record = this.records.get(key);
    if (record && record.resourceId) {
      // Update access timestamp and attempts
      record.lastAttemptAt = new Date();
      record.attempts += 1;
      
      return {
        resourceId: record.resourceId,
        resourceType: record.resourceType!
      };
    }
    return null;
  }

  /**
   * Check if a key exists
   */
  async keyExists(key: string): Promise<boolean> {
    return this.records.has(key);
  }

  /**
   * Get the current status of an idempotency key
   */
  async getKeyStatus(key: string): Promise<{
    exists: boolean;
    locked: boolean;
    expired: boolean;
    hasResource: boolean;
    attempts: number;
    resourceId?: string;
    resourceType?: string;
  } | null> {
    this.validateKey(key);
    
    const record = this.records.get(key);
    if (!record) {
      return null;
    }
    
    const now = new Date();
    return {
      exists: true,
      locked: record.locked,
      expired: record.expiresAt < now,
      hasResource: !!record.resourceId,
      attempts: record.attempts,
      resourceId: record.resourceId,
      resourceType: record.resourceType
    };
  }

  /**
   * Clean up expired records
   */
  async cleanup(): Promise<void> {
    const now = new Date().getTime();
    let expiredCount = 0;
    
    for (const [key, record] of this.records.entries()) {
      if (record.expiresAt.getTime() < now) {
        this.records.delete(key);
        expiredCount++;
      }
    }
    
    if (expiredCount > 0) {
      this.logger.info(`Cleaned up ${expiredCount} expired idempotency records`);
      
      // Emit cleanup event
      if (this.eventEmitter) {
        this.eventEmitter.emit('idempotency.cleanup', {
          recordsRemoved: expiredCount,
          remainingRecords: this.records.size
        }).catch(error => {
          this.logger.error('Failed to emit cleanup event', { error });
        });
      }
    }
  }

  /**
   * Get the total number of idempotency records
   */
  getRecordCount(): number {
    return this.records.size;
  }

  /**
   * Force reset a key (for disaster recovery scenarios)
   */
  async forceResetKey(key: string): Promise<boolean> {
    this.validateKey(key);
    
    const exists = this.records.has(key);
    if (exists) {
      this.records.delete(key);
      this.logger.warn('Forced reset of idempotency key', { key });
      
      // Emit key reset event
      if (this.eventEmitter) {
        this.eventEmitter.emit('idempotency.key_reset', {
          key,
          timestamp: new Date()
        }).catch(error => {
          this.logger.error('Failed to emit key reset event', { error });
        });
      }
    }
    
    return exists;
  }

  /**
   * Generate a hash from request body for replay detection
   */
  private generateRequestHash(data: any): string {
    try {
      // Sort keys for consistent hashing regardless of property order
      const normalized = typeof data === 'string' 
        ? data 
        : JSON.stringify(this.sortObject(data));
        
      return createHash('sha256')
        .update(normalized)
        .digest('hex');
    } catch (error) {
      this.logger.warn('Failed to generate request hash', { error });
      return '';
    }
  }

  /**
   * Sort object keys recursively for consistent serialization
   */
  private sortObject(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    
    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map(item => this.sortObject(item));
    }
    
    // Handle regular objects
    const sorted: Record<string, any> = {};
    const keys = Object.keys(obj).sort();
    
    for (const key of keys) {
      sorted[key] = this.sortObject(obj[key]);
    }
    
    return sorted;
  }

  /**
   * Validate idempotency key
   */
  private validateKey(key: string): void {
    if (!key) {
      throw errorHandler.createError(
        'Idempotency key is required',
        ErrorCode.VALIDATION_ERROR
      );
    }
    
    if (typeof key !== 'string') {
      throw errorHandler.createError(
        'Idempotency key must be a string',
        ErrorCode.VALIDATION_ERROR
      );
    }
    
    if (key.length < 8) {
      throw errorHandler.createError(
        'Idempotency key must be at least 8 characters',
        ErrorCode.VALIDATION_ERROR
      );
    }
  }
}
