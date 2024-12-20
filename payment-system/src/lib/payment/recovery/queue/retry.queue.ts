// src/lib/payment/recovery/queue/retry.queue.ts
import { EventEmitter } from 'events';

export class RetryQueue extends EventEmitter {
  private queue: Map<string, NodeJS.Timeout> = new Map();

  async enqueue(transactionId: string, delay: number): Promise<void> {
    if (this.queue.has(transactionId)) {
      clearTimeout(this.queue.get(transactionId)!);
    }

    const timeout = setTimeout(() => {
      this.emit('retry', transactionId);
      this.queue.delete(transactionId);
    }, delay);

    this.queue.set(transactionId, timeout);
  }

  async dequeue(transactionId: string): Promise<void> {
    const timeout = this.queue.get(transactionId);
    if (timeout) {
      clearTimeout(timeout);
      this.queue.delete(transactionId);
    }
  }

  async clear(): Promise<void> {
    for (const timeout of this.queue.values()) {
      clearTimeout(timeout);
    }
    this.queue.clear();
  }
}