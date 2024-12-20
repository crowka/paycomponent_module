import { PaymentProviderInterface, ProviderConfig } from '../types/provider.types';
import { StripeProvider } from './stripe-provider';

export class PaymentProviderFactory {
  private static providers: Record<string, new () => PaymentProviderInterface> = {
    stripe: StripeProvider
  };

  static async createProvider(
    name: string,
    config: ProviderConfig
  ): Promise<PaymentProviderInterface> {
    const Provider = this.providers[name];
    
    if (!Provider) {
      throw new Error(`Payment provider ${name} not supported`);
    }

    const provider = new Provider();
    await provider.initialize(config);
    return provider;
  }

  static registerProvider(
    name: string,
    provider: new () => PaymentProviderInterface
  ): void {
    this.providers[name] = provider;
  }
}