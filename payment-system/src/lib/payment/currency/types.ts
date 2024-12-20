// src/lib/payment/currency/types.ts
export interface ExchangeRate {
  sourceCurrency: string;
  targetCurrency: string;
  rate: number;
  timestamp: Date;
  provider: string;
}

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  isActive: boolean;
}