// src/lib/payment/utils/record-locker.ts
import { v4 as uuidv4 } from 'uuid';
import { PaymentLogger } from './logger';
import { errorHandler, ErrorCode } from './error';
import { EventEmitter } from '../events/event.emitter';

export enum LockLevel {
  SHARED = 'shared',    // Multiple readers allowed
  EXCLUSIVE = 'exclusive' // Single writer only
}

export interface RecordLock {
  recordId: string;
  resourceType: string;
  lockLevel: LockLevel;
  acquiredAt: Date;
  expiresAt: Date;
  owner: string;
  lastRenewed?: Date;
  lockId: string;
  ownerTransaction?: string;
  metadata?: Record<string, any>;
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
  
  /**
   * Transaction ID if this lock is part of a transaction
   */
  transactionId?: string;
  
  /**
   * Lock level (shared or exclusive)
   */
  lockLevel?: LockLevel;
  
  /**
   * Additional metadata to store with the lock
   */
  metadata?: Record<string, any>;
}

export interface LockQueue {
  recordId: string;
  resourceType: string;
  waitingLocks: Array<{
    owner: string;
    lockLevel: LockLevel;
    timestamp: Date;
    resolve: (lockId: string) => void;
    reject: (error: Error) => void;
    transactionId?: string;
  }>;
}

/**
 * RecordLocker provides record-level locking for critical operations
 * to prevent concurrent modifications and ensure data integrity.
 * Implements a multi-level locking system with deadlock prevention.
 */
export class RecordLocker {
  private locks: Map<string, RecordLock[]> = new Map();
  private lockQueues: Map<string, LockQueue> = new Map();
  private logger: PaymentLogger;
  private instanceId: string;
  private renewalTimers: Map<string, NodeJS.Timeout> = new Map();
  private defaultExpirationMs: number = 30000; // 30 seconds
  private renewalIntervalMs: number = 10000; // 10 seconds
  private cleanupIntervalMs: number = 60000; // 1 minute
  private cleanupTimer?: NodeJS.Timeout;
  private eventEmitter?: EventEmitter;
  private transactionLocks: Map<string, Set<string>> = new Map(); // Track locks by transaction
  
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
    this.eventEmitter = options.eventEmitter;
    
    // Start periodic cleanup
    if (typeof setInterval !== 'undefined') {
      this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
    }
  }
  
  /**
   * Acquires a lock on a record. If the lock is already held, it will retry until
   * the lock becomes available or the wait timeout is reached.
   * 
   * Implements lock compatibility matrix:
   * - Multiple shared locks can coexist
   * - Exclusive lock cannot coexist with any other lock
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
      maxRetries = Math.floor(waitTimeoutMs / retryIntervalMs),
      transactionId,
      lockLevel = LockLevel.EXCLUSIVE,
      metadata = {}
    } = options;
    
    const lockKey = this.getLockKey(recordId, resourceType);
    const startTime = Date.now();
    
    // Create lock queue entry if needed
    if (!this.lockQueues.has(lockKey)) {
      this.lockQueues.set(lockKey, {
        recordId,
        resourceType,
        waitingLocks: []
      });
    }
    
    // Check for potential deadlock if this is part of a transaction
    if (transactionId) {
      if (this.wouldCreateDeadlock(recordId, resourceType, transactionId, lockLevel)) {
        throw errorHandler.createError(
          `Potential deadlock detected for transaction ${transactionId} on ${resourceType}:${recordId}`,
          ErrorCode.DEADLOCK_DETECTED,
          { recordId, resourceType, transactionId }
        );
      }
    }
    
    // Try to acquire lock immediately if compatible
    const canAcquireImmediately = this.canAcquireLock(lockKey, lockLevel, this.instanceId, transactionId);
    if (canAcquireImmediately) {
      return this.createLock(recordId, resourceType, lockLevel, expirationMs, transactionId, metadata);
    }
    
    // If we can't acquire immediately, wait if timeout allows
    if (waitTimeoutMs <= 0) {
      throw errorHandler.createError(
        `Failed to acquire ${lockLevel} lock on ${resourceType}:${recordId} (no wait requested)`,
        ErrorCode.LOCK_ACQUISITION_FAILED,
        { recordId, resourceType, lockLevel }
      );
    }
    
    // Create a promise that will resolve when the lock is acquired or timeout occurs
    return new Promise<string>((resolve, reject) => {
      const queue = this.lockQueues.get(lockKey)!;
      
      // Add to waiting queue
      queue.waitingLocks.push({
        owner: this.instanceId,
        lockLevel,
        timestamp: new Date(),
        resolve,
        reject,
        transactionId
      });
      
      this.logger.debug(`Added ${lockLevel} lock request to queue for ${resourceType}:${recordId}`, {
        queueLength: queue.waitingLocks.length,
        transactionId
      });
      
      // Set timeout to reject promise if lock isn't acquired in time
      setTimeout(() => {
        // Remove from queue if still there
        const queue = this.lockQueues.get(lockKey);
        if (queue) {
          const index = queue.waitingLocks.findIndex(l => 
            l.owner === this.instanceId && 
            l.timestamp.getTime() === startTime
          );
          
          if (index >= 0) {
            queue.waitingLocks.splice(index, 1);
            
            reject(errorHandler.createError(
              `Timeout waiting to acquire ${lockLevel} lock on ${resourceType}:${recordId}`,
              ErrorCode.LOCK_TIMEOUT,
              { recordId, resourceType, waitTimeoutMs, lockLevel }
            ));
          }
        }
      }, waitTimeoutMs);
    });
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
    const locks = this.locks.get(lockKey);
    
    if (!locks || locks.length === 0) {
      this.logger.warn(`Attempted to release non-existent lock on ${resourceType}:${recordId}`);
      return false;
    }
    
    let lockReleased = false;
    const remainingLocks: RecordLock[] = [];
    
    // Find and remove the specified lock
    for (const lock of locks) {
      const shouldRelease = 
        lock.owner === this.instanceId && 
        (!lockId || lock.lockId === lockId);
      
      if (shouldRelease) {
        this.logger.debug(`Released ${lock.lockLevel} lock on ${resourceType}:${recordId}`, {
          lockId: lock.lockId,
          transactionId: lock.ownerTransaction
        });
        
        // Remove from transaction tracking if applicable
        if (lock.ownerTransaction) {
          this.removeTransactionLock(lock.ownerTransaction, lock.lockId);
        }
        
        // Clear renewal timer
        const timerKey = `${lockKey}:${lock.lockId}`;
        const timer = this.renewalTimers.get(timerKey);
        if (timer) {
          clearTimeout(timer);
          this.renewalTimers.delete(timerKey);
        }
        
        // Mark that we released at least one lock
        lockReleased = true;
        
        // Emit lock released event
        if (this.eventEmitter) {
          this.eventEmitter.emit('lock.released', {
            recordId,
            resourceType,
            lockId: lock.lockId,
            lockLevel: lock.lockLevel,
            owner: this.instanceId,
            transactionId: lock.ownerTransaction
          }).catch(error => {
            this.logger.error('Failed to emit lock released event', { error });
          });
        }
      } else {
        // Keep locks we're not releasing
        remainingLocks.push(lock);
      }
    }
    
    // Update the locks map
    if (remainingLocks.length > 0) {
      this.locks.set(lockKey, remainingLocks);
    } else {
      this.locks.delete(lockKey);
    }
    
    // Process waiting queue if we released any locks
    if (lockReleased) {
      this.processWaitingQueue(lockKey);
    }
    
    return lockReleased;
  }
  
  /**
   * Release all locks owned by a specific transaction
   */
  async releaseTransactionLocks(transactionId: string): Promise<number> {
    const lockIds = this.transactionLocks.get(transactionId);
    if (!lockIds || lockIds.size === 0) {
      return 0;
    }
    
    let releasedCount = 0;
    
    // Go through all locks in the system to find and release those owned by this transaction
    for (const [lockKey, locks] of this.locks.entries()) {
      const [resourceType, recordId] = this.parseKey(lockKey);
      const remainingLocks: RecordLock[] = [];
      let lockReleased = false;
      
      for (const lock of locks) {
        if (lock.ownerTransaction === transactionId && lock.owner === this.instanceId) {
          this.logger.debug(`Released transaction lock on ${resourceType}:${recordId}`, {
            lockId: lock.lockId,
            transactionId
          });
          
          // Clear renewal timer
          const timerKey = `${lockKey}:${lock.lockId}`;
          const timer = this.renewalTimers.get(timerKey);
          if (timer) {
            clearTimeout(timer);
            this.renewalTimers.delete(timerKey);
          }
          
          releasedCount++;
          lockReleased = true;
          
          // Emit lock released event
          if (this.eventEmitter) {
            this.eventEmitter.emit('lock.transaction_released', {
              recordId,
              resourceType,
              lockId: lock.lockId,
              lockLevel: lock.lockLevel,
              transactionId
            }).catch(error => {
              this.logger.error('Failed to emit transaction lock released event', { error });
            });
          }
        } else {
          remainingLocks.push(lock);
        }
      }
      
      // Update the locks map
      if (remainingLocks.length > 0) {
        this.locks.set(lockKey, remainingLocks);
      } else {
        this.locks.delete(lockKey);
      }
      
      // Process waiting queue if we released any locks for this key
      if (lockReleased) {
        this.processWaitingQueue(lockKey);
      }
    }
    
    // Clear transaction tracking
    this.transactionLocks.delete(transactionId);
    
    this.logger.info(`Released ${releasedCount} locks for transaction ${transactionId}`);
    return releasedCount;
  }
  
  /**
   * Checks if a record is currently locked
   */
  isLocked(
    recordId: string, 
    resourceType: string, 
    lockLevel: LockLevel = LockLevel.EXCLUSIVE
  ): boolean {
    const lockKey = this.getLockKey(recordId, resourceType);
    const locks = this.locks.get(lockKey);
    
    if (!locks || locks.length === 0) {
      return false;
    }
    
    // For SHARED lock check, we only care if there's an EXCLUSIVE lock
    if (lockLevel === LockLevel.SHARED) {
      return locks.some(lock => 
        lock.lockLevel === LockLevel.EXCLUSIVE && 
        new Date() <= lock.expiresAt
      );
    }
    
    // For EXCLUSIVE lock check, any lock (shared or exclusive) counts
    return locks.some(lock => new Date() <= lock.expiresAt);
  }
  
  /**
   * Gets information about current locks on a record
   */
  getLockInfo(
    recordId: string,
    resourceType: string
  ): Array<Omit<RecordLock, 'lockId'>> {
    const lockKey = this.getLockKey(recordId, resourceType);
    const locks = this.locks.get(lockKey);
    
    if (!locks || locks.length === 0) {
      return [];
    }
    
    // Return non-sensitive information about locks
    return locks.map(lock => {
      const { lockId, ...lockInfo } = lock;
      return lockInfo;
    });
  }
  
  /**
   * Upgrade a shared lock to an exclusive lock
   */
  async upgradeLock(
    recordId: string,
    resourceType: string,
    lockId: string,
    options: Omit<LockOptions, 'lockLevel'> = {}
  ): Promise<string> {
    const lockKey = this.getLockKey(recordId, resourceType);
    const locks = this.locks.get(lockKey);
    
    if (!locks || locks.length === 0) {
      throw errorHandler.createError(
        `Cannot upgrade non-existent lock on ${resourceType}:${recordId}`,
        ErrorCode.LOCK_NOT_FOUND,
        { recordId, resourceType, lockId }
      );
    }
    
    // Find the lock to upgrade
    const lockIndex = locks.findIndex(lock => 
      lock.owner === this.instanceId && 
      lock.lockId === lockId && 
      lock.lockLevel === LockLevel.SHARED
    );
    
    if (lockIndex === -1) {
      throw errorHandler.createError(
        `Cannot find shared lock to upgrade on ${resourceType}:${recordId}`,
        ErrorCode.LOCK_NOT_FOUND,
        { recordId, resourceType, lockId }
      );
    }
    
    // Check if upgrade is possible (no other locks should exist)
    if (locks.length > 1) {
      // If there are other locks that would conflict with exclusive
      throw errorHandler.createError(
        `Cannot upgrade lock due to other concurrent locks on ${resourceType}:${recordId}`,
        ErrorCode.LOCK_UPGRADE_FAILED,
        { recordId, resourceType, lockId, existingLocks: locks.length }
      );
    }
    
    // Perform the upgrade
    const existingLock = locks[lockIndex];
    const {
      expirationMs = this.defaultExpirationMs,
      transactionId = existingLock.ownerTransaction,
      metadata = existingLock.metadata
    } = options;
    
    // Update the lock level
    existingLock.lockLevel = LockLevel.EXCLUSIVE;
    existingLock.lastRenewed = new Date();
    existingLock.expiresAt = new Date(Date.now() + expirationMs);
    
    this.logger.info(`Upgraded lock on ${resourceType}:${recordId} from SHARED to EXCLUSIVE`, {
      lockId,
      transactionId
    });
    
    // Emit lock upgraded event
    if (this.eventEmitter) {
      this.eventEmitter.emit('lock.upgraded', {
        recordId,
        resourceType,
        lockId,
        owner: this.instanceId,
        transactionId
      }).catch(error => {
        this.logger.error('Failed to emit lock upgraded event', { error });
      });
    }
    
    return lockId;
  }
  
  /**
   * Clean up expired locks and manage waiting queue
   */
  private cleanup(): void {
    const now = new Date();
    let removedCount = 0;
    let processedQueueCount = 0;
    
    // Process each lock key
    for (const [lockKey, locks] of this.locks.entries()) {
      const validLocks: RecordLock[] = [];
      let lockReleased = false;
      
      // Check each lock for expiration
      for (const lock of locks) {
        if (now > lock.expiresAt) {
          this.logger.warn(`Cleaning up expired ${lock.lockLevel} lock on ${lock.resourceType}:${lock.recordId}`, {
            lockId: lock.lockId,
            owner: lock.owner,
            transactionId: lock.ownerTransaction,
            expiredAt: lock.expiresAt
          });
          
          // Clear any renewal timer
          const timerKey = `${lockKey}:${lock.lockId}`;
          const timer = this.renewalTimers.get(timerKey);
          if (timer) {
            clearTimeout(timer);
            this.renewalTimers.delete(timerKey);
          }
          
          // Remove from transaction tracking if applicable
          if (lock.ownerTransaction) {
            this.removeTransactionLock(lock.ownerTransaction, lock.lockId);
          }
          
          removedCount++;
          lockReleased = true;
          
          // Emit lock expired event
          if (this.eventEmitter) {
            this.eventEmitter.emit('lock.expired', {
              recordId: lock.recordId,
              resourceType: lock.resourceType,
              lockId: lock.lockId,
              lockLevel: lock.lockLevel,
              owner: lock.owner,
              transactionId: lock.ownerTransaction,
              expiresAt: lock.expiresAt
            }).catch(error => {
              this.logger.error('Failed to emit lock expired event', { error });
            });
          }
        } else {
          validLocks.push(lock);
        }
      }
      
      // Update or remove the lock entry
      if (validLocks.length > 0) {
        this.locks.set(lockKey, validLocks);
      } else {
        this.locks.delete(lockKey);
      }
      
      // Process waiting queue if any locks were released
      if (lockReleased) {
        const processed = this.processWaitingQueue(lockKey);
        if (processed) {
          processedQueueCount++;
        }
      }
    }
    
    if (removedCount > 0) {
      this.logger.info(`Cleaned up ${removedCount} expired locks, processed ${processedQueueCount} waiting queues`);
    }
  }
  
  /**
   * Process the waiting queue for a lock key
   */
  private processWaitingQueue(lockKey: string): boolean {
    const queue = this.lockQueues.get(lockKey);
    if (!queue || queue.waitingLocks.length === 0) {
      return false;
    }
    
    let processed = false;
    const remainingWaiters: LockQueue['waitingLocks'] = [];
    
    // Try to satisfy waiters in FIFO order
    for (const waiter of queue.waitingLocks) {
      const canAcquire = this.canAcquireLock(
        lockKey, 
        waiter.lockLevel, 
        waiter.owner,
        waiter.transactionId
      );
      
      if (canAcquire) {
        // Create the lock and resolve the promise
        try {
          const lockId = this.createLock(
            queue.recordId,
            queue.resourceType,
            waiter.lockLevel,
            this.defaultExpirationMs,
            waiter.transactionId
          );
          
          waiter.resolve(lockId);
          processed = true;
          
          this.logger.debug(`Granted ${waiter.lockLevel} lock to waiter for ${queue.resourceType}:${queue.recordId}`, {
            lockId,
            transactionId: waiter.transactionId
          });
        } catch (error) {
          waiter.reject(error);
        }
      } else {
        // Keep in the queue if can't acquire yet
        remainingWaiters.push(waiter);
      }
    }
    
    // Update the queue
    queue.waitingLocks = remainingWaiters;
    
    return processed;
  }
  
  /**
   * Check if a lock can be acquired based on compatibility with existing locks
   */
  private canAcquireLock(
    lockKey: string,
    lockLevel: LockLevel,
    owner: string,
    transactionId?: string
  ): boolean {
    const locks = this.locks.get(lockKey) || [];
    
    // Filter out expired locks
    const activeLocks = locks.filter(lock => new Date() <= lock.expiresAt);
    
    // If no active locks, we can always acquire
    if (activeLocks.length === 0) {
      return true;
    }
    
    // If requesting exclusive lock, no other locks can exist
    if (lockLevel === LockLevel.EXCLUSIVE) {
      return false;
    }
    
    // If requesting shared lock, no exclusive locks can exist
    const hasExclusiveLock = activeLocks.some(lock => 
      lock.lockLevel === LockLevel.EXCLUSIVE
    );
    
    return !hasExclusiveLock;
  }
  
  /**
   * Create a new lock and set up renewal
   */
  private createLock(
    recordId: string,
    resourceType: string,
    lockLevel: LockLevel,
    expirationMs: number,
    transactionId?: string,
    metadata: Record<string, any> = {}
  ): string {
    const lockKey = this.getLockKey(recordId, resourceType);
    const now = new Date();
    const lockId = uuidv4();
    
    const lock: RecordLock = {
      recordId,
      resourceType,
      lockLevel,
      acquiredAt: now,
      expiresAt: new Date(now.getTime() + expirationMs),
      owner: this.instanceId,
      lockId,
      ownerTransaction: transactionId,
      metadata
    };
    
    // Add to locks map
    const locks = this.locks.get(lockKey) || [];
    locks.push(lock);
    this.locks.set(lockKey, locks);
    
    // Track by transaction if applicable
    if (transactionId) {
      this.trackTransactionLock(transactionId, lockId);
    }
    
    this.logger.debug(`Acquired ${lockLevel} lock on ${resourceType}:${recordId}`, { 
      lockId,
      transactionId
    });
    
    // Set up automatic renewal
    this.setupLockRenewal(lockKey, lockId, expirationMs);
    
    // Emit lock acquired event
    if (this.eventEmitter) {
      this.eventEmitter.emit('lock.acquired', {
        recordId,
        resourceType,
        lockId,
        lockLevel,
        owner: this.instanceId,
        transactionId
      }).catch(error => {
        this.logger.error('Failed to emit lock acquired event', { error });
      });
    }
    
    return lockId;
  }
  
  /**
   * Track locks by transaction ID for easier cleanup
   */
  private trackTransactionLock(transactionId: string, lockId: string): void {
    if (!this.transactionLocks.has(transactionId)) {
      this.transactionLocks.set(transactionId, new Set());
    }
    
    this.transactionLocks.get(transactionId)!.add(lockId);
  }
  
  /**
   * Remove transaction lock tracking
   */
  private removeTransactionLock(transactionId: string, lockId: string): void {
    const lockIds = this.transactionLocks.get(transactionId);
    if (lockIds) {
      lockIds.delete(lockId);
      if (lockIds.size === 0) {
        this.transactionLocks.delete(transactionId);
      }
    }
  }
  
  /**
   * Set up automatic lock renewal
   */
  private setupLockRenewal(
    lockKey: string,
    lockId: string,
    expirationMs: number
  ): void {
    // Clear any existing timer
    const timerKey = `${lockKey}:${lockId}`;
    const existingTimer = this.renewalTimers.get(timerKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Create renewal timer at half the expiration time to ensure we renew before expiry
    const timer = setTimeout(() => {
      this.renewLock(lockKey, lockId, expirationMs);
    }, Math.floor(expirationMs / 2));
    
    this.renewalTimers.set(timerKey, timer);
  }
  
  /**
   * Renew a lock before it expires
   */
  private renewLock(
    lockKey: string,
    lockId: string,
    expirationMs: number
  ): void {
    const locks = this.locks.get(lockKey);
    if (!locks) return;
    
    const lock = locks.find(l => l.lockId === lockId && l.owner === this.instanceId);
    if (!lock) return;
    
    const now = new Date();
    lock.lastRenewed = now;
    lock.expiresAt = new Date(now.getTime() + expirationMs);
    
    this.logger.debug(`Renewed ${lock.lockLevel} lock on ${lock.resourceType}:${lock.recordId}`, {
      lockId,
      transactionId: lock.ownerTransaction
    });
    
    // Set up next renewal
    this.setupLockRenewal(lockKey, lockId, expirationMs);
  }
  
  /**
   * Check for potential deadlocks when acquiring a new lock
   */
  private wouldCreateDeadlock(
    recordId: string,
    resourceType: string,
    transactionId: string,
    lockLevel: LockLevel
  ): boolean {
    // Check if this record is already locked by another transaction
    const lockKey = this.getLockKey(recordId, resourceType);
    const locks = this.locks.get(lockKey) || [];
    
    // If no locks or only our transaction's locks, no deadlock
    if (locks.length === 0 || locks.every(l => l.ownerTransaction === transactionId)) {
      return false;
    }
    
    // Check for potential circular wait conditions
    for (const lock of locks) {
      // Skip locks from our transaction
      if (lock.ownerTransaction === transactionId) continue;
      
      // If we find an exclusive lock or we're requesting exclusive
      // and there's already any lock, check for circular dependency
      if (lock.lockLevel === LockLevel.EXCLUSIVE || 
         (lockLevel === LockLevel.EXCLUSIVE && locks.length > 0)) {
        
        // See if the other transaction is waiting on any records we have locked
        const otherTxId = lock.ownerTransaction;
        if (!otherTxId) continue;
        
        // Check if we can detect a circular wait
        if (this.hasCircularWait(transactionId, otherTxId, new Set())) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  /**
   * Check for circular wait conditions that could lead to deadlocks
   */
  private hasCircularWait(
    startTxId: string,
    currentTxId: string,
    visited: Set<string>
  ): boolean {
    // Prevent infinite recursion
    if (visited.has(currentTxId)) return false;
    visited.add(currentTxId);
    
    // Check if current transaction is waiting on any locks held by our starting transaction
    for (const [lockKey, locks] of this.locks.entries()) {
      const locksHeldByStart = locks.filter(l => l.ownerTransaction === startTxId);
      if (locksHeldByStart.length === 0) continue;
      
      // Check if the current transaction is waiting for any of these locks
      const queue = this.lockQueues.get(lockKey);
      if (!queue) continue;
      
      const isWaiting = queue.waitingLocks.some(w => w.transactionId === currentTxId);
      if (isWaiting) {
        // Found circular wait
        return true;
      }
      
      // Check if any transaction that the current tx is waiting on is in turn waiting on our start tx
      for (const waitingLock of queue.waitingLocks) {
        if (waitingLock.transactionId && waitingLock.transactionId !== currentTxId) {
          if (this.hasCircularWait(startTxId, waitingLock.transactionId, new Set(visited))) {
            return true;
          }
        }
      }
    }
    
    return false;
  }
  
  /**
   * Generate a composite key for the lock map
   */
  private getLockKey(recordId: string, resourceType: string): string {
    return `${resourceType}:${recordId}`;
  }
  
  /**
   * Parse a lock key back into resource type and record ID
   */
  private parseKey(lockKey: string): [string, string] {
    const [resourceType, recordId] = lockKey.split(':');
    return [resourceType, recordId];
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
    this.lockQueues.clear();
    this.transactionLocks.clear();
  }
  /**
  * Get metrics about the current state of the record locker
  */
 getMetrics(): {
   totalLocks: number;
   sharedLocks: number;
   exclusiveLocks: number;
   waitingRequests: number;
   transactions: number;
   expiringWithin10Seconds: number;
   locksByResourceType: Record<string, number>;
 } {
   let sharedLocks = 0;
   let exclusiveLocks = 0;
   let waitingRequests = 0;
   let expiringWithin10Seconds = 0;
   const locksByResourceType: Record<string, number> = {};
   const now = new Date();
   const soon = new Date(now.getTime() + 10000); // 10 seconds from now
   
   // Count locks by type
   for (const locks of this.locks.values()) {
     for (const lock of locks) {
       if (lock.lockLevel === LockLevel.SHARED) {
         sharedLocks++;
       } else {
         exclusiveLocks++;
       }
       
       // Count by resource type
       locksByResourceType[lock.resourceType] = 
         (locksByResourceType[lock.resourceType] || 0) + 1;
         
       // Check expiration
       if (lock.expiresAt <= soon) {
         expiringWithin10Seconds++;
       }
     }
   }
   
   // Count waiting requests
   for (const queue of this.lockQueues.values()) {
     waitingRequests += queue.waitingLocks.length;
   }
   
   return {
     totalLocks: sharedLocks + exclusiveLocks,
     sharedLocks,
     exclusiveLocks,
     waitingRequests,
     transactions: this.transactionLocks.size,
     expiringWithin10Seconds,
     locksByResourceType
   };
 }
}
