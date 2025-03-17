// src/lib/payment/transaction/utils/idempotency.ts

import { v4 as uuidv4 } from 'uuid';

export class IdempotencyManager {
  private keys: Map<string, { locked: boolean, timestamp: Date }> = new Map();
  private lockExpiration = 300000; // 5 minutes in milliseconds

  async checkAndLock(key: string): Promise<void> {
    // Check if key exists and is still valid
    const existing = this.keys.get(key);
    
    if (existing) {
      // If key exists and is locked, it's a duplicate request
      if (existing.locked) {
        throw new Error('Duplicate request');
      }
      
      // If key exists but lock expired, we can reset it
      const now = new Date();
      if (now.getTime() - existing.timestamp.getTime() > this.lockExpiration) {
        existing.locked = true;
        existing.timestamp = now;
        return;
      }
    }
    
    // Otherwise, create a new lock
    this.keys.set(key, { 
      locked: true, 
      timestamp: new Date() 
    });
  }

  async releaseLock(key: string): Promise<void> {
    const existing = this.keys.get(key);
    if (existing) {
      existing.locked = false;
    }
  }

  async cleanupExpiredLocks(): Promise<void> {
    const now = new Date().getTime();
    for (const [key, value] of this.keys.entries()) {
      if (now - value.timestamp.getTime() > this.lockExpiration) {
        this.keys.delete(key);
      }
    }
  }
}
