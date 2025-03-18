// src/lib/payment/transaction/utils/idempotency.ts
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { PaymentLogger } from '../../utils/logger';
import { errorHandler, ErrorCode } from '../../utils/error';
import { EventEmitter } from '../../events/event.emitter';

export interface RequestContext {
  path: string;
  method: string;
  bodyHash: string;
  timestamp: Date;
}

export interface IdempotencyRecord {
  key: string;
  locked: boolean;
  timestamp: Date;
  resourceId?: string;
  resourceType?: string;
  expiresAt: Date;
  requestHash?: string;
  requestContext?: RequestContext;
  cachedResponse?: string;
  attempts: number;
  lastAttemptAt?: Date;
}

export class IdempotencyManager {
  private records: Map<string, IdempotencyRecord> = new Map();
  private logger: PaymentLogger;
  private lockExpirationMs: number;
  private recordExpirationMs: number;
  private eventEmitter?: EventEmitter;
  private staleRequestTimeoutMs: number;

  constructor(
    options: {
      lockExpirationMs?: number;
      recordExpirationMs?: number;
      staleRequestTimeoutMs?: number;
      eventEmitter?: EventEmitter;
    } = {}
  ) {
    this.lockExpirationMs = options.lockExpirationMs || 300000; // 5 minutes default lock expiration
    this.recordExpirationMs = options.recordExpirationMs || 86400000; // 24 hours default record expiration
    this.staleRequestTimeoutMs = options.staleRequestTimeoutMs || 3600000; // 1 hour default for stale requests
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
  async checkAndLock(key: string, requestContext?: RequestContext): Promise<boolean> {
    this.validateKey(key);
    
    // First run cleanup
    this.cleanup();

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
      
      // Check for replay attack with different request context
      if (requestContext && existing.requestHash && 
          requestContext.bodyHash !== existing.requestHash) {
        this.logger.warn('Possible replay attack detected: same idempotency key with different request body', {
          key,
          attempts: existing.attempts,
          originalPath: existing.requestContext?.path,
          newPath: requestContext.path
        });
        
        // Emit replay detection event
        if (this.eventEmitter) {
          this.eventEmitter.emit('idempotency.replay_detected', {
            key,
            attempts: existing.attempts,
            originalTimestamp: existing.timestamp,
            newTimestamp: new Date(),
            originalPath: existing.requestContext?.path,
            newPath: requestContext.path
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
        // Check if this is a stale lock (hanging process)
        if (now > existing.expiresAt) {
          this.logger.warn('Detected stale lock, resetting', { 
            key,
            lockedAt: existing.timestamp,
            expiredAt: existing.expiresAt
          });
          
          existing.locked = true;
          existing.timestamp = now;
          existing.expiresAt = new Date(now.getTime() + this.lockExpirationMs);
          
          // Emit stale lock event
          if (this.eventEmitter) {
            this.eventEmitter.emit('idempotency.stale_lock_reset', {
              key,
              originalLockTime: existing.timestamp,
              newLockTime: now
            }).catch(error => {
              this.logger.error('Failed to emit stale lock event', { error });
            });
          }
          
          return true;
        }
        
        // Otherwise, it's a duplicate request during processing
        this.logger.warn('Duplicate request while operation in progress', {
          key, 
          lockedAt: existing.timestamp,
          timeElapsed: Date.now() - existing.timestamp.getTime()
        });
        
        // Emit duplicate request event
        if (this.eventEmitter) {
          this.eventEmitter.emit('idempotency.duplicate_request', {
            key,
            status: 'in_progress',
            attempts: existing.attempts,
            resourceId: existing.resourceId
          }).catch(error => {
            this.logger.error('Failed to emit duplicate request event', { error });
          });
        }
        
        throw errorHandler.createError(
          'Duplicate request: operation is in progress',
          ErrorCode.DUPLICATE_REQUEST,
          { 
            idempotencyKey: key,
            inProgressSince: existing.timestamp
          }
        );
      }
      
      // If we have a completed operation linked to this key
      if (existing.resourceId) {
        this.logger.info('Request with previously completed operation', {
          key,
          resourceId: existing.resourceId,
          resourceType: existing.resourceType
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
      
      // Update request context if provided
      if (requestContext) {
        existing.requestContext = requestContext;
        existing.requestHash = requestContext.bodyHash;
      }
      
      return true;
    }
    
    // Create a new lock
    const now = new Date();
    this.records.set(key, { 
      key,
      locked: true, 
      timestamp: now,
      expiresAt: new Date(now.getTime() + this.lockExpirationMs),
      requestHash: requestContext?.bodyHash,
      requestContext,
      attempts: 1,
      lastAttemptAt: now
    });
    
    this.logger.info('Created new idempotency record', { 
      key, 
      requestHash: requestContext?.bodyHash ? '[present]' : '[not provided]',
      path: requestContext?.path 
    });
    
    // Emit new key event
    if (this.eventEmitter) {
      this.eventEmitter.emit('idempotency.key_created', {
        key,
        timestamp: now,
        path: requestContext?.path
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
    resourceType: string,
    cachedResponse?: string,
    requestHash?: string
  ): Promise<void> {
    this.validateKey(key);
    
    const record = this.records.get(key);
    if (record) {
      record.resourceId = resourceId;
      record.resourceType = resourceType;
      record.locked = false;
      
      // Store cache response if provided
      if (cachedResponse) {
        record.cachedResponse = cachedResponse;
      }
      
      // Update request hash if provided and not already set
      if (requestHash && !record.requestHash) {
        record.requestHash = requestHash;
      }
      
      // Extend expiration time since we now have an associated resource
      record.expiresAt = new Date(Date.now() + this.recordExpirationMs);
      
      this.logger.info('Associated resource with idempotency key', { 
        key, 
        resourceId, 
        resourceType,
        hasCachedResponse: !!cachedResponse
      });
      
      // Emit resource association event
      if (this.eventEmitter) {
        this.eventEmitter.emit('idempotency.resource_associated', {
          key,
          resourceId,
          resourceType,
          attempts: record.attempts,
          hasCachedResponse: !!cachedResponse
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
    requestHash?: string;
    cachedResponse?: string;
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
      requestHash: record.requestHash,
      cachedResponse: record.cachedResponse,
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
    let staleCount = 0;
    
    for (const [key, record] of this.records.entries()) {
      // Remove expired records
      if (record.expiresAt.getTime() < now) {
        this.records.delete(key);
        expiredCount++;
        continue;
      }
      
      // Detect and handle stale locked requests
      if (record.locked && !record.resourceId) {
        const lockDuration = now - record.timestamp.getTime();
        
        // If the lock has been held for too long, consider it stale
        if (lockDuration > this.staleRequestTimeoutMs) {
          this.logger.warn(`Detected stale request for key ${key}, releasing lock`, {
            lockedFor: `${Math.round(lockDuration / 1000 / 60)} minutes`
          });
          
          record.locked = false;
          staleCount++;
          
          // Emit stale request event
          if (this.eventEmitter) {
            this.eventEmitter.emit('idempotency.stale_request_detected', {
              key,
              lockedSince: record.timestamp,
              duration: lockDuration
            }).catch(error => {
              this.logger.error('Failed to emit stale request event', { error });
            });
          }
        }
      }
    }
    
    if (expiredCount > 0 || staleCount > 0) {
      this.logger.info(`Cleaned up ${expiredCount} expired idempotency records and detected ${staleCount} stale requests`);
      
      // Emit cleanup event
      if (this.eventEmitter) {
        this.eventEmitter.emit('idempotency.cleanup', {
          recordsRemoved: expiredCount,
          staleRecordsDetected: staleCount,
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
   * Get metrics and statistics about idempotency system
   */
  getMetrics(): {
    totalRecords: number;
    lockedRecords: number;
    completedRecords: number;
    averageAttempts: number;
    oldestRecord: Date | null;
  } {
    let lockedCount = 0;
    let completedCount = 0;
    let totalAttempts = 0;
    let oldestTimestamp: Date | null = null;
    
    for (const record of this.records.values()) {
      if (record.locked) lockedCount++;
      if (record.resourceId) completedCount++;
      totalAttempts += record.attempts;
      
      if (!oldestTimestamp || record.timestamp < oldestTimestamp) {
        oldestTimestamp = record.timestamp;
      }
    }
    
    return {
      totalRecords: this.records.size,
      lockedRecords: lockedCount,
      completedRecords: completedCount,
      averageAttempts: this.records.size > 0 ? totalAttempts / this.records.size : 0,
      oldestRecord: oldestTimestamp
    };
  }

  /**
   * Check if any idempotency key is in a locked state for a specific resource
   * Used to prevent conflicts between different operations on the same resource
   */
  isResourceLocked(resourceType: string, resourceId: string): boolean {
    for (const record of this.records.values()) {
      if (record.locked && 
          record.resourceType === resourceType && 
          record.resourceId === resourceId) {
        return true;
      }
    }
    return false;
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
    
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
      throw errorHandler.createError(
        'Idempotency key must contain only alphanumeric characters, hyphens, and underscores',
        ErrorCode.VALIDATION_ERROR
      );
    }
  }
}
