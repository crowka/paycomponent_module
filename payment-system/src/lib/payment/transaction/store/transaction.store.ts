// src/lib/payment/transaction/store/transaction.store.ts
import { Transaction, TransactionStatus, TransactionType } from '../types';

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
}