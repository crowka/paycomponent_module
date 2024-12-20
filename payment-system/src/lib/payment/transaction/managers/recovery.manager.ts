// src/lib/payment/transaction/managers/recovery.manager.ts
import { 
  Transaction, 
  TransactionStatus, 
  TransactionError,
  RecoveryStrategy 
} from '../types';
import { TransactionStore } from '../store/transaction.store';
import { DeadLetterQueue } from '../recovery/queue/dead-letter.queue';

export class RecoveryManager {
  constructor(
    private store: TransactionStore,
    private deadLetterQueue: DeadLetterQueue,
    private strategies: RecoveryStrategy[]
  ) {}

  async initiateRecovery(
    transaction: Transaction,
    error: TransactionError
  ): Promise<Transaction> {
    const strategy = this.strategies.find(s => s.canHandle(error));
    
    if (!strategy) {
      return this.moveToDeadLetter(transaction, error);
    }

    const updatedTransaction = {
      ...transaction,
      status: TransactionStatus.RECOVERY_IN_PROGRESS,
      updatedAt: new Date()
    };

    await this.store.save(updatedTransaction);

    try {
      await strategy.execute(updatedTransaction);
      return this.completeRecovery(updatedTransaction);
    } catch (recoveryError) {
      return this.moveToDeadLetter(updatedTransaction, error);
    }
  }

  private async completeRecovery(transaction: Transaction): Promise<Transaction> {
    const updatedTransaction = {
      ...transaction,
      status: TransactionStatus.COMPLETED,
      updatedAt: new Date(),
      completedAt: new Date()
    };

    await this.store.save(updatedTransaction);
    return updatedTransaction;
  }

  private async moveToDeadLetter(
    transaction: Transaction,
    error: TransactionError
  ): Promise<Transaction> {
    const updatedTransaction = {
      ...transaction,
      status: TransactionStatus.FAILED,
      error,
      updatedAt: new Date(),
      failedAt: new Date()
    };

    await this.store.save(updatedTransaction);
    await this.deadLetterQueue.enqueue(updatedTransaction);
    
    return updatedTransaction;
  }
}