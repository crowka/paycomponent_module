// src/lib/payment/container.ts
import { ITransactionRepository } from './repositories/transaction.repository';
import { PaymentValidator } from './validators/payment.validator';
import { PaymentLogger } from './utils/logger';
import { PaymentService } from './services/payment.service';
import { EventEmitter } from './events/event.emitter';
import { PaymentProviderInterface } from './types/provider.types';

export class PaymentContainer {
  private static instance: PaymentContainer;
  private repositories: Map<string, any> = new Map();
  private services: Map<string, any> = new Map();
  private providers: Map<string, any> = new Map();

  private constructor() {}

  static getInstance(): PaymentContainer {
    if (!PaymentContainer.instance) {
      PaymentContainer.instance = new PaymentContainer();
    }
    return PaymentContainer.instance;
  }

  registerRepository(key: string, repository: any): void {
    this.repositories.set(key, repository);
  }

  registerProvider(key: string, provider: PaymentProviderInterface): void {
    this.providers.set(key, provider);
  }

  getRepository<T>(key: string): T {
    const repository = this.repositories.get(key);
    if (!repository) {
      throw new Error(`Repository ${key} not found`);
    }
    return repository;
  }

  getProvider<T extends PaymentProviderInterface>(key: string): T {
    const provider = this.providers.get(key);
    if (!provider) {
      throw new Error(`Provider ${key} not found`);
    }
    return provider;
  }

  createPaymentService(options = {}): PaymentService {
    // Get or create dependencies
    const repository = this.getRepository<ITransactionRepository>('TransactionRepository');
    const provider = this.getProvider('PaymentProvider');
    const validator = new PaymentValidator();
    const eventEmitter = new EventEmitter();
    const logger = new PaymentLogger();

    // Create service with all required dependencies
    return new PaymentService(
      provider,
      repository,
      validator,
      eventEmitter,
      options
    );
  }
}

// Then in your index.ts or main initialization file:
export function initializePaymentSystem(supabaseClient: any) {
  const container = PaymentContainer.getInstance();

  // Register repositories
  container.registerRepository(
    'TransactionRepository', 
    new SupabaseTransactionRepository(supabaseClient)
  );

  // Register payment provider
  container.registerProvider(
    'PaymentProvider',
    new StripeProvider(/* stripe config */)
  );

  // Create service instance with all dependencies
  const paymentService = container.createPaymentService({
    logLevel: 'info'
  });

  return paymentService;
}
