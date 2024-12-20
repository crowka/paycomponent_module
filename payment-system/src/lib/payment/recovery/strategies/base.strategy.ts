// src/lib/payment/recovery/strategies/base.strategy.ts
import { Transaction, TransactionError } from '../../transaction/types';

export abstract class RecoveryStrategy {
  abstract canHandle(error: TransactionError): boolean;
  abstract execute(transaction: Transaction): Promise<void>;
}