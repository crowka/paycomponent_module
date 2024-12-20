// src/lib/payment/customer/customer.manager.ts
import { v4 as uuidv4 } from 'uuid';
import {
  CustomerProfile,
  RiskLevel,
  CustomerStatus,
  CustomerPreferences,
  SpendingLimits
} from './types';
import { CustomerStore } from './customer.store';
import { EventEmitter } from '../events/event.emitter';

export class CustomerManager {
  constructor(
    private store: CustomerStore,
    private eventEmitter: EventEmitter
  ) {}

  async createProfile(
    email: string,
    options: {
      name?: string;
      defaultCurrency?: string;
      preferences?: Partial<CustomerPreferences>;
      limits?: Partial<SpendingLimits>;
      metadata?: Record<string, any>;
    } = {}
  ): Promise<CustomerProfile> {
    const existingProfile = await this.store.findByEmail(email);
    if (existingProfile) {
      throw new Error('Customer profile already exists');
    }

    const profile: CustomerProfile = {
      id: uuidv4(),
      email,
      name: options.name,
      defaultCurrency: options.defaultCurrency || 'USD',
      riskLevel: RiskLevel.LOW,
      metadata: options.metadata || {},
      preferences: {
        communicationChannel: 'email',
        savePaymentMethods: true,
        autoPayEnabled: false,
        ...options.preferences
      },
      limits: {
        currency: options.defaultCurrency || 'USD',
        ...options.limits
      },
      status: CustomerStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await this.store.save(profile);
    await this.eventEmitter.emit('customer.created', profile);

    return profile;
  }

  async updateProfile(
    id: string,
    updates: Partial<CustomerProfile>
  ): Promise<CustomerProfile> {
    const profile = await this.store.get(id);
    if (!profile) {
      throw new Error('Customer profile not found');
    }

    const updatedProfile = {
      ...profile,
      ...updates,
      updatedAt: new Date()
    };

    await this.store.save(updatedProfile);
    await this.eventEmitter.emit('customer.updated', updatedProfile);

    return updatedProfile;
  }

  async updateSpendingLimits(
    id: string,
    limits: Partial<SpendingLimits>
  ): Promise<CustomerProfile> {
    const profile = await this.store.get(id);
    if (!profile) {
      throw new Error('Customer profile not found');
    }

    const updatedProfile = await this.updateProfile(id, {
      limits: { ...profile.limits, ...limits }
    });

    await this.eventEmitter.emit('customer.limits_updated', {
      customerId: id,
      limits: updatedProfile.limits
    });

    return updatedProfile;
  }

  async assessRisk(id: string): Promise<RiskLevel> {
    const profile = await this.store.get(id);
    if (!profile) {
      throw new Error('Customer profile not found');
    }

    // Implement risk assessment logic
    // This is a placeholder implementation
    const riskFactors = await this.calculateRiskFactors(profile);
    const riskLevel = this.determineRiskLevel(riskFactors);

    if (riskLevel !== profile.riskLevel) {
      await this.updateProfile(id, { riskLevel });
      await this.eventEmitter.emit('customer.risk_level_changed', {
        customerId: id,
        oldLevel: profile.riskLevel,
        newLevel: riskLevel
      });
    }

    return riskLevel;
  }

  async validateTransaction(
    customerId: string,
    amount: number,
    currency: string
  ): Promise<boolean> {
    const profile = await this.store.get(customerId);
    if (!profile) {
      throw new Error('Customer profile not found');
    }

    // Check customer status
    if (profile.status !== CustomerStatus.ACTIVE) {
      throw new Error(`Customer account is ${profile.status}`);
    }

    // Convert amount to customer's default currency if needed
    const normalizedAmount = currency !== profile.limits.currency
      ? await this.currencyManager.convertAmount(amount, currency, profile.limits.currency)
      : amount;

    // Check spending limits
    const periodLimits = await this.checkPeriodLimits(profile, normalizedAmount);
    const transactionLimit = this.checkTransactionLimit(profile, normalizedAmount);

    return periodLimits && transactionLimit;
  }

  private async checkPeriodLimits(
    profile: CustomerProfile,
    amount: number
  ): Promise<boolean> {
    const now = new Date();
    const transactions = await this.transactionStore.getCustomerTransactions(profile.id);

    // Daily limit check
    if (profile.limits.daily) {
      const dailyTotal = this.calculatePeriodTotal(
        transactions,
        now,
        'day'
      );
      if (dailyTotal + amount > profile.limits.daily) {
        throw new Error('Daily spending limit exceeded');
      }
    }

    // Weekly limit check
    if (profile.limits.weekly) {
      const weeklyTotal = this.calculatePeriodTotal(
        transactions,
        now,
        'week'
      );
      if (weeklyTotal + amount > profile.limits.weekly) {
        throw new Error('Weekly spending limit exceeded');
      }
    }

    // Monthly limit check
    if (profile.limits.monthly) {
      const monthlyTotal = this.calculatePeriodTotal(
        transactions,
        now,
        'month'
      );
      if (monthlyTotal + amount > profile.limits.monthly) {
        throw new Error('Monthly spending limit exceeded');
      }
    }

    return true;
  }

  private checkTransactionLimit(
    profile: CustomerProfile,
    amount: number
  ): boolean {
    if (profile.limits.perTransaction && amount > profile.limits.perTransaction) {
      throw new Error('Transaction amount exceeds limit');
    }
    return true;
  }

  private calculatePeriodTotal(
    transactions: Transaction[],
    now: Date,
    period: 'day' | 'week' | 'month'
  ): number {
    let startDate: Date;
    
    switch (period) {
      case 'day':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }

    return transactions
      .filter(tx => tx.timestamp >= startDate && tx.status === 'completed')
      .reduce((total, tx) => total + tx.amount, 0);
  }

  private async calculateRiskFactors(
    profile: CustomerProfile
  ): Promise<RiskFactors> {
    const transactions = await this.transactionStore.getCustomerTransactions(profile.id);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const recentTransactions = transactions.filter(tx => 
      tx.timestamp >= thirtyDaysAgo
    );

    return {
      transactionVolume: recentTransactions.length,
      totalSpent: recentTransactions.reduce((sum, tx) => sum + tx.amount, 0),
      failureRate: this.calculateFailureRate(recentTransactions),
      accountAge: this.calculateAccountAge(profile.createdAt),
      hasVerifiedPaymentMethod: await this.hasVerifiedPaymentMethod(profile.id)
    };
  }

  private determineRiskLevel(factors: RiskFactors): RiskLevel {
    // Implement risk scoring logic
    let riskScore = 0;

    // Transaction volume score
    if (factors.transactionVolume > 100) riskScore += 1;
    if (factors.transactionVolume > 500) riskScore += 2;

    // Failure rate score
    if (factors.failureRate > 0.1) riskScore += 2;
    if (factors.failureRate > 0.2) riskScore += 3;

    // Account age score
    if (factors.accountAge < 30) riskScore += 2;
    if (factors.accountAge < 7) riskScore += 3;

    // Payment method verification score
    if (!factors.hasVerifiedPaymentMethod) riskScore += 2;

    // Determine risk level based on score
    if (riskScore >= 7) return RiskLevel.HIGH;
    if (riskScore >= 4) return RiskLevel.MEDIUM;
    return RiskLevel.LOW;
  }

  private calculateFailureRate(transactions: Transaction[]): number {
    if (transactions.length === 0) return 0;
    
    const failedCount = transactions.filter(tx => 
      tx.status === 'failed'
    ).length;
    
    return failedCount / transactions.length;
  }

  private calculateAccountAge(createdAt: Date): number {
    return Math.floor(
      (Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000)
    );
  }

  private async hasVerifiedPaymentMethod(customerId: string): Promise<boolean> {
    const paymentMethods = await this.paymentMethodManager.getCustomerPaymentMethods(
      customerId
    );
    
    return paymentMethods.some(method => 
      !method.isExpired && method.details.verified
    );
  }
}

interface RiskFactors {
  transactionVolume: number;
  totalSpent: number;
  failureRate: number;
  accountAge: number;
  hasVerifiedPaymentMethod: boolean;
}