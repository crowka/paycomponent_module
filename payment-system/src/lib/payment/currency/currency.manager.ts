// src/lib/payment/currency/currency.manager.ts
import { ExchangeRate, Currency } from './types';

export class CurrencyManager {
  private exchangeRates: Map<string, ExchangeRate> = new Map();
  private currencies: Map<string, Currency> = new Map();
  private providers: Map<string, ExchangeRateProvider> = new Map();

  constructor(private defaultProvider: string) {
    this.loadCurrencies();
  }

  async convertAmount(
    amount: number,
    fromCurrency: string,
    toCurrency: string
  ): Promise<number> {
    if (fromCurrency === toCurrency) {
      return amount;
    }

    const rate = await this.getExchangeRate(fromCurrency, toCurrency);
    const convertedAmount = amount * rate;
    const currency = this.currencies.get(toCurrency);
    
    if (!currency) {
      throw new Error(`Currency not found: ${toCurrency}`);
    }

    return Number(convertedAmount.toFixed(currency.decimals));
  }

  async getExchangeRate(
    fromCurrency: string,
    toCurrency: string
  ): Promise<number> {
    const key = `${fromCurrency}-${toCurrency}`;
    const cachedRate = this.exchangeRates.get(key);

    if (cachedRate && this.isRateValid(cachedRate)) {
      return cachedRate.rate;
    }

    const provider = this.providers.get(this.defaultProvider);
    if (!provider) {
      throw new Error('No exchange rate provider configured');
    }

    const rate = await provider.getRate(fromCurrency, toCurrency);
    this.exchangeRates.set(key, rate);
    
    return rate.rate;
  }

  registerProvider(name: string, provider: ExchangeRateProvider): void {
    this.providers.set(name, provider);
  }

  validateCurrency(currencyCode: string): boolean {
    const currency = this.currencies.get(currencyCode);
    return currency !== undefined && currency.isActive;
  }

  formatAmount(amount: number, currencyCode: string): string {
    const currency = this.currencies.get(currencyCode);
    if (!currency) {
      throw new Error(`Currency not found: ${currencyCode}`);
    }

    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: currency.decimals,
      maximumFractionDigits: currency.decimals
    }).format(amount);
  }

  private isRateValid(rate: ExchangeRate): boolean {
    const MAX_RATE_AGE = 15 * 60 * 1000; // 15 minutes
    return Date.now() - rate.timestamp.getTime() < MAX_RATE_AGE;
  }

  private loadCurrencies(): void {
    // Load supported currencies
    const currencies: Currency[] = [
      {
        code: 'USD',
        name: 'US Dollar',
        symbol: '$',
        decimals: 2,
        isActive: true
      },
      {
        code: 'EUR',
        name: 'Euro',
        symbol: '€',
        decimals: 2,
        isActive: true
      },
      {
        code: 'GBP',
        name: 'British Pound',
        symbol: '£',
        decimals: 2,
        isActive: true
      }
      // Add more currencies as needed
    ];

    currencies.forEach(currency => {
      this.currencies.set(currency.code, currency);
    });
  }
}

// Example exchange rate provider implementation
interface ExchangeRateProvider {
  getRate(fromCurrency: string, toCurrency: string): Promise<ExchangeRate>;
}

export class ExternalExchangeRateProvider implements ExchangeRateProvider {
  async getRate(
    fromCurrency: string,
    toCurrency: string
  ): Promise<ExchangeRate> {
    // Implement external API call to get exchange rate
    // This is a placeholder implementation
    return {
      sourceCurrency: fromCurrency,
      targetCurrency: toCurrency,
      rate: 1.0, // Replace with actual rate
      timestamp: new Date(),
      provider: 'external'
    };
  }
}