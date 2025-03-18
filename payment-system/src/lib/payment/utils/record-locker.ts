// src/lib/payment/utils/record-locker.ts
import { v4 as uuidv4 } from 'uuid';
import { PaymentLogger } from './logger';
import { errorHandler, ErrorCode } from './error';
import { EventEmitter } from '../events/event.emitter';

export interface RecordLock {
  recordId: string;
  resourceType: string;
  acquiredAt: Date;
  expiresAt: Date;
  owner: string;
  lastRenewed?: Date;
  lockId: string;
}

export interface LockOptions {
  /**
   * Duration in milliseconds after which the lock expires if not renewed
   */
  expirationMs?: number;
  
  /**
   * Maximum time in milliseconds to wait trying to acquire the lock
   */
  waitTimeoutMs?: number;
  
  /**
   * Time in milliseconds between retry attempts
   */
  retryIntervalMs?: number;
  
  /**
   * Maximum number of retry attempts
   */
  maxRetries?: number;
}

/**
 * RecordLocker provides record-level locking for critical operations
 * to prevent concurrent modifications and ensure data integrity.
 */
export class RecordLocker {
  private locks: Map<string, RecordLock> = new Map();
  private logger: PaymentLogger;
  private instanceId: string;
  private renewalTimers: Map<string, NodeJS.Timeout> = new Map();
  private defaultExpirationMs: number = 30000; // 30 seconds
  private renewalIntervalMs: number = 10000; // 10 seconds
  private cleanupIntervalMs: number = 60000; // 1 minute
  private cleanupTimer?: NodeJS.Timeout;
  
  constructor(
    options: {
      defaultExpirationMs?: number;
      renewalIntervalMs?: number;
      cleanupIntervalMs?: number;
      instanceId?: string;
      eventEmitter?: EventEmitter;
    } = {}
  ) {
    this.logger = new PaymentLogger('info', 'RecordLocker');
    this.instanceId = options.instanceId || uuidv4();
    this.defaultExpirationMs = options.defaultExpirationMs || this.defaultExpirationMs;
    this.renewalIntervalMs = options.renewalIntervalMs || this.renewalIntervalMs;
    this.cleanupIntervalMs = options.cleanupIntervalMs || this.cleanupIntervalMs;
    
    // Start periodic cleanup
    if (typeof setInterval !== 'undefined') {
      this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
    }
  }
  
  /**
   * Acquires a lock on a record. If the lock is already held, it will retry until
   * the lock becomes available or the wait timeout is reached.
   */
  async acquireLock(
    recordId: string,
    resourceType: string,
    options: LockOptions = {}
  ): Promise<string> {
    const {
      expirationMs = this.defaultExpirationMs,
      waitTimeoutMs = 5000,
      retryIntervalMs = 100,
      maxRetries = Math.floor(waitTimeoutMs / retryIntervalMs)
    } = options;
    
    const lockKey = this.getLockKey(recordId, resourceType);
    const startTime = Date.now();
    let attempts = 0;
    
    while (attempts <= maxRetries) {
      attempts++;
      
      // Check if we've exceeded wait timeout
      if (Date.now() - startTime > waitTimeoutMs) {
        throw errorHandler.createError(
          `Timeout waiting to acquire lock on ${resourceType}:${recordId}`,
          ErrorCode.LOCK_TIMEOUT,
          { recordId, resourceType, waitTimeoutMs }
        );
      }
      
      // Try to acquire lock
      const existingLock = this.locks.get(lockKey);
      
      // If no lock exists or it's expired, acquire it
      if (!existingLock || new Date() > existingLock.expiresAt) {
        if (existingLock) {
          this.logger.warn(`Taking over expired lock for ${resourceType}:${recordId}`, {
            previousOwner: existingLock.owner,
            expiredAt: existingLock.expiresAt
          });
        }
        
        const now = new Date();
        const lockId = uuidv4();
        const lock: RecordLock = {
          recordId,
          resourceType,
          acquiredAt: now,
          expiresAt: new Date(now.getTime() + expirationMs),
          owner: this.instanceId,
          lockId
        };
        
        this.locks.set(lockKey, lock);
        this.logger.debug(`Acquired lock on ${resourceType}:${recordId}`, { lockId });
        
        // Set up automatic renewal
        this.setupLockRenewal(lockKey, expirationMs);
        
        return lockId;
      }
      
      // Already locked by current instance - just return the lockId
      if (existingLock.owner === this.instanceId) {
        this.renewLock(lockKey, expirationMs);
        return existingLock.lockId;
      }
      
      // If locked by another process, wait and retry
      this.logger.debug(`Lock on ${resourceType}:${recordId} held by another process, retrying...`, {
        owner: existingLock.owner,
        attempt: attempts,
        maxRetries
      });
      
      await new Promise(resolve => setTimeout(resolve, retryIntervalMs));
    }
    
    // After max retries, throw error
    throw errorHandler.createError(
      `Failed to acquire lock on ${resourceType}:${recordId} after ${attempts} attempts`,
      ErrorCode.LOCK_ACQUISITION_FAILED,
      { recordId, resourceType, attempts }
    );
  }
  
  /**
   * Releases a lock if it's owned by the current instance
   */
  async releaseLock(
    recordId: string,
    resourceType: string,
    lockId?: string
  ): Promise<boolean> {
    const lockKey = this.getLockKey(recordId, resourceType);
    const lock = this.locks.get(lockKey);
    
    if (!lock) {
      this.logger.warn(`Attempted to release non-existent lock on ${resourceType}:${recordId}`);
      return false;
    }
    
    // Only release if owned by current instance and lockId matches (if provided)
    if (lock.owner === this.instanceId && (!lockId || lock.lockId === lockId)) {
      this.locks.delete(lockKey);
      
      // Clear renewal timer
      const timer = this.renewalTimers.get(lockKey);
      if (timer) {
        clearTimeout(timer);
        this.renewalTimers.delete(lockKey);
      }
      
      this.logger.debug(`Released lock on ${resourceType}:${recordId}`, { 
        lockId: lock.lockId
      });
      
      return true;
    } else if (lock.owner !== this.instanceId) {
      this.logger.warn(`Cannot release lock owned by different instance`, {
        resourceType,
        recordId,
        owner: lock.owner,
        requester: this.instanceId
      });
    } else if (lockId && lock.lockId !== lockId) {
      this.logger.warn(`Cannot release lock, lockId mismatch`, {
        resourceType,
        recordId,
        expectedLockId: lockId,
        actualLockId: lock.lockId
      });
    }
    
    return false;
  }
  
  /**
   * Forcibly releases a lock regardless of ownership
   * Should only be used in administrative or recovery scenarios
   */
  async forceReleaseLock(
    recordId: string,
    resourceType: string
  ): Promise<boolean> {
    const lockKey = this.getLockKey(recordId, resourceType);
    const lock = this.locks.get(lockKey);
    
    if (!lock) {
      return false;
    }
    
    this.locks.delete(lockKey);
    
    // Clear renewal timer
    const timer = this.renewalTimers.get(lockKey);
    if (timer) {
      clearTimeout(timer);
      this.renewalTimers.delete(lockKey);
    }
    
    this.logger.warn(`Forcibly released lock on ${resourceType}:${recordId}`, {
      owner: lock.owner,
      acquiredAt: lock.acquiredAt,
      forcedBy: this.instanceId
    });
    
    return true;
  }
  
  /**
   * Checks if a record is currently locked
   */
  isLocked(recordId: string, resourceType: string): boolean {
    const lockKey = this.getLockKey(recordId, resourceType);
    const lock = this.locks.get(lockKey);
    
    if (!lock) {
      return false;
    }
    
    // Check if lock has expired
    if (new Date() > lock.expiresAt) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Gets information about a current lock
   */
  getLockInfo(
    recordId: string,
    resourceType: string
  ): Omit<RecordLock, 'lockId'> | null {
    const lockKey = this.getLockKey(recordId, resourceType);
    const lock = this.locks.get(lockKey);
    
    if (!lock) {
      return null;
    }
    
    // Don't expose lockId for security reasons
    const { lockId, ...lockInfo } = lock;
    return lockInfo;
  }
  
  /**
   * Cleanup expired locks
   */
  private cleanup(): void {
    const now = new Date();
    let removedCount = 0;
    
    for (const [key, lock] of this.locks.entries()) {
      if (now > lock.expiresAt) {
        this.locks.delete(key);
        
        // Clear any renewal timer
        const timer = this.renewalTimers.get(key);
        if (timer) {
          clearTimeout(timer);
          this.renewalTimers.delete(key);
        }
        
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      this.logger.info(`Cleaned up ${removedCount} expired locks`);
    }
  }
  
  /**
   * Renew an existing lock
   */
  private renewLock(
    lockKey: string,
    expirationMs: number = this.defaultExpirationMs
  ): void {
    const lock = this.locks.get(lockKey);
    if (lock && lock.owner === this.instanceId) {
      const now = new Date();
      lock.lastRenewed = now;
      lock.expiresAt = new Date(now.getTime() + expirationMs);
      this.logger.debug(`Renewed lock for ${lock.resourceType}:${lock.recordId}`, {
        lockId: lock.lockId
      });
    }
  }
  
  /**
   * Setup automatic lock renewal
   */
  private setupLockRenewal(
    lockKey: string,
    expirationMs: number = this.defaultExpirationMs
  ): void {
    // Clear any existing timer
    const existingTimer = this.renewalTimers.get(lockKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Create renewal timer
    const timer = setTimeout(() => {
      const lock = this.locks.get(lockKey);
      if (lock && lock.owner === this.instanceId) {
        this.renewLock(lockKey, expirationMs);
        
        // Set up next renewal
        this.setupLockRenewal(lockKey, expirationMs);
      }
    }, this.renewalIntervalMs);
    
    this.renewalTimers.set(lockKey, timer);
  }
  
  /**
   * Generates a composite key for the lock map
   */
  private getLockKey(recordId: string, resourceType: string): string {
    return `${resourceType}:${recordId}`;
  }
  
  /**
   * Clean up timers on shutdown
   */
  dispose(): void {
    // Clear all renewal timers
    for (const timer of this.renewalTimers.values()) {
      clearTimeout(timer);
    }
    this.renewalTimers.clear();
    
    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    this.locks.clear();
  }
}
