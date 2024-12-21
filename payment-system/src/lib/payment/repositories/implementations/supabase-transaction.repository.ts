// src/lib/payment/repositories/implementations/supabase-transaction.repository.ts
export class SupabaseTransactionRepository implements ITransactionRepository {
  constructor(private supabaseClient: SupabaseClient) {}
  
  async save(transaction: Transaction): Promise<void> {
    await this.supabaseClient
      .from('transactions')
      .insert(transaction);
  }
  
  async findByCustomer(customerId: string, options: TransactionQuery): Promise<Transaction[]> {
    let query = this.supabaseClient
      .from('transactions')
      .select('*')
      .eq('customerId', customerId);
      
    if (options.status) {
      query = query.eq('status', options.status);
    }
    
    return query;
  }
  // ... other methods
}
