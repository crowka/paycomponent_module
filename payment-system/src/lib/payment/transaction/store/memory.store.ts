// src/lib/payment/transaction/store/memory.store.ts

// Import from the main transaction store file to avoid duplication
import { 
  TransactionStore, 
  InMemoryTransactionStore as ConsolidatedInMemoryTransactionStore 
} from './transaction.store';

// Re-export for backward compatibility
export class InMemoryTransactionStore extends ConsolidatedInMemoryTransactionStore {
  // No need to reimplement anything since we're extending the consolidated implementation
}

// Re-export the TransactionStore abstract class for backward compatibility
export { TransactionStore };
