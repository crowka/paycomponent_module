// src/lib/payment/transaction/utils/idempotency.ts
import { v4 as uuidv4 } from 'uuid';
import { PaymentLogger } from '../../utils/logger';
import { errorHandler, ErrorCode } from '../../utils/error';

export interface IdempotencyRecord {
  key: string;
  locked: boolean;
  timestamp: Date;
  resourceId?: string;
  resourceType?: string;
  expiresAt: Date;
}

export class IdempotencyManager {
  private records: Map<string, IdempotencyRecord> = new Map();
  private logger: PaymentLogger;
  private lockExpirationMs: number;
  private recordExpirationMs: number;

  constructor(
    lockExpirationMs: number = 300000, // 5 minutes default lock expiration
    recordExpirationMs: number = 86400000 // 24 hours default record expiration
  ) {
    this.lockExpirationMs = lockExpirationMs;
    this.recordExpirationMs = recordExpirationMs;
    this.logger = new PaymentLogger('info', 'IdempotencyManager');
  }

  async checkAndLock(key: string): Promise<boolean> {
    this.validateKey(key);
    
    // First run cleanup
    this.cleanup();

    // Check if key exists and is still valid
    const existing = this.records.get(key);

    if (existing) {
      this.logger.info('Found existing idempotency record', { 
        key, 
        locked: existing.locked,
        resourceId: existing.resourceId
      });
      
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
        
        // Otherwise, it's a duplicate request
        throw errorHandler.createError(
          'Duplicate request: operation is in progress',
          ErrorCode.DUPLICATE_REQUEST,
          { idempotencyKey: key }
        );
      }
      
      // If we have a completed operation linked to this key
      if (existing.resourceId) {
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
      expiresAt: new Date(now.getTime() + this.lockExpirationMs)
    });
    
    this.logger.info('Created new idempotency record', { key });
    return true;
  }

  async releaseLock(key: string): Promise<void> {
    this.validateKey(key);
    
    const record = this.records.get(key);
    if (record) {
      record.locked = false;
      this.logger.info('Released idempotency lock', { key });
    } else {
      this.logger.warn('Attempted to release non-existent lock', { key });
    }
  }

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
    } else {
      this.logger.warn('Attempted to associate resource with non-existent key', { 
        key, 
        resourceId, 
        resourceType 
      });
    }
  }

  async getAssociatedResource(
    key: string
  ): Promise<{ resourceId: string; resourceType: string } | null> {
    this.validateKey(key);
    
    const record = this.records.get(key);
    if (record && record.resourceId) {
      return {
        resourceId: record.resourceId,
        resourceType: record.resourceType!
      };
    }
    return null;
  }

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
    }
  }

  getRecordCount(): number {
    return this.records.size;
  }

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
