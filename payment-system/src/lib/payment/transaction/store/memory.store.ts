// src/lib/payment/transaction/store/memory.store.ts
export class InMemoryTransactionStore extends TransactionStore {
  private transactions: Map<string, Transaction> = new Map();

  async save(transaction: Transaction): Promise<void> {
    this.transactions.set(transaction.id, { ...transaction });
  }

  async get(id: string): Promise<Transaction | null> {
    const transaction = this.transactions.get(id);
    return transaction ? { ...transaction } : null;
  }

  async query(
    customerId: string,
    options: TransactionQuery
  ): Promise<Transaction[]> {
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

    const start = options.offset || 0;
    const end = options.limit ? start + options.limit : undefined;

    return results.slice(start, end);
  }

  async delete(id: string): Promise<void> {
    this.transactions.delete(id);
  }
}