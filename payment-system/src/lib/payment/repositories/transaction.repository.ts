// src/lib/payment/repositories/transaction.repository.ts
export interface ITransactionRepository {
  save(transaction: Transaction): Promise<void>;
  findById(id: string): Promise<Transaction | null>;
  findByCustomer(customerId: string, options: TransactionQuery): Promise<Transaction[]>;
  update(id: string, data: Partial<Transaction>): Promise<void>;
  delete(id: string): Promise<void>;
}
