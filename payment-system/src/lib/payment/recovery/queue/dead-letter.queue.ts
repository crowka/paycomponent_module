// src/lib/payment/recovery/queue/dead-letter.queue.ts

import { Transaction } from '../../transaction/types';
import { EventEmitter } from '../../events/event.emitter';

export class DeadLetterQueue {
  private queue: Transaction[] = [];
  private eventEmitter: EventEmitter;

  constructor(eventEmitter: EventEmitter) {
    this.eventEmitter = eventEmitter;
  }

  async enqueue(transaction: Transaction): Promise<void> {
    this.queue.push({ ...transaction });
    await this.eventEmitter.emit('transaction.moved_to_dlq', transaction);
  }

  async getAll(): Promise<Transaction[]> {
    return [...this.queue];
  }

  async remove(transactionId: string): Promise<void> {
    this.queue = this.queue.filter(tx => tx.id !== transactionId);
  }

  async reprocess(transactionId: string): Promise<Transaction | null> {
    const transaction = this.queue.find(tx => tx.id === transactionId);
    if (transaction) {
      await this.remove(transactionId);
      await this.eventEmitter.emit('transaction.retry_from_dlq', transaction);
      return transaction;
    }
    return null;
  }
}
