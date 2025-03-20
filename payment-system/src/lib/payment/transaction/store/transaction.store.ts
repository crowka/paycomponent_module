// src/lib/payment/transaction/store/transaction.store.ts

import { Transaction, TransactionStatus, TransactionType } from '../../types/transaction.types';

export interface TransactionQuery {
  customerId?: string;
  status?: TransactionStatus;
  type?: TransactionType;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export abstract class TransactionStore {
  abstract save(transaction: Transaction): Promise<void>;
  abstract get(id: string): Promise<Transaction | null>;
  abstract query(
    customerId: string,
    options: TransactionQuery
  ): Promise<Transaction[]>;
  abstract delete(id: string): Promise<void>;
  abstract findByIdempotencyKey(key: string): Promise<Transaction | null>;
  
  // Optional method for reconciliation, can be implemented by concrete classes
  queryAll?(options: TransactionQuery): Promise<Transaction[]>;
}

// Consolidated implementation of InMemoryTransactionStore
export class InMemoryTransactionStore extends TransactionStore {
  private transactions: Map<string, Transaction> = new Map();
  private idempotencyKeys: Map<string, string> = new Map();

  async save(transaction: Transaction): Promise<void> {
    this.transactions.set(transaction.id, { ...transaction });
    if (transaction.idempotencyKey) {
      this.idempotencyKeys.set(transaction.idempotencyKey, transaction.id);
    }
  }

  async get(id: string): Promise<Transaction | null> {
    const transaction = this.transactions.get(id);
    return transaction ? { ...transaction } : null;
  }

  async query(customerId: string, options: TransactionQuery): Promise<Transaction[]> {
    let results = Array.from(this.transactions.values())
      .filter(tx => tx.customerId === customerId);

    if (options.status) {
      results = results.filter(tx => tx.status === options.status);
    }

    if (options.type) {
      results = results.filter(tx => tx.type === options.type);
    }

    if (options.startDate) {
      results = results.filter(tx => tx.createdAt >= options.startDate!);
    }

    if (options.endDate) {
      results = results.filter(tx => tx.createdAt <= options.endDate!);
    }

    // Sort results by creation date, newest first
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const start = options.offset || 0;
    const end = options.limit ? start + options.limit : undefined;

    return results.slice(start, end).map(tx => ({ ...tx }));
  }

  async delete(id: string): Promise<void> {
    const transaction = this.transactions.get(id);
    if (transaction?.idempotencyKey) {
      this.idempotencyKeys.delete(transaction.idempotencyKey);
    }
    this.transactions.delete(id);
  }

  async findByIdempotencyKey(key: string): Promise<Transaction | null> {
    const transactionId = this.idempotencyKeys.get(key);
    if (!transactionId) return null;
    return this.get(transactionId);
  }

  // Implement queryAll for reconciliation
  async queryAll(options: TransactionQuery): Promise<Transaction[]> {
    let results = Array.from(this.transactions.values());

    if (options.status) {
      results = results.filter(tx => tx.status === options.status);
    }

    if (options.type) {
      results = results.filter(tx => tx.type === options.type);
    }

    if (options.startDate) {
      results = results.filter(tx => tx.createdAt >= options.startDate!);
    }

    if (options.endDate) {
      results = results.filter(tx => tx.createdAt <= options.endDate!);
    }

    // Sort results by creation date, newest first
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const start = options.offset || 0;
    const end = options.limit ? start + options.limit : undefined;

    return results.slice(start, end).map(tx => ({ ...tx }));
  }

  // Helper method for testing
  async clear(): Promise<void> {
    this.transactions.clear();
    this.idempotencyKeys.clear();
  }
}
