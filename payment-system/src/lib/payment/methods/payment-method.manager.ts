// src/lib/payment/methods/payment-method.manager.ts
import { v4 as uuidv4 } from 'uuid';
import { PaymentMethod, PaymentMethodType, PaymentMethodDetails } from './types';
import { PaymentMethodStore } from './payment-method.store';
import { EventEmitter } from '../events/event.emitter';

export class PaymentMethodManager {
  constructor(
    private store: PaymentMethodStore,
    private eventEmitter: EventEmitter
  ) {}

  async addPaymentMethod(
    customerId: string,
    type: PaymentMethodType,
    provider: string,
    details: PaymentMethodDetails,
    setAsDefault: boolean = false
  ): Promise<PaymentMethod> {
    // If setting as default, unset current default
    if (setAsDefault) {
      await this.unsetDefaultMethod(customerId);
    }

    const paymentMethod: PaymentMethod = {
      id: uuidv4(),
      customerId,
      type,
      provider,
      isDefault: setAsDefault,
      isExpired: false,
      metadata: {},
      details,
      expiryDate: this.calculateExpiryDate(details),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await this.store.save(paymentMethod);
    await this.eventEmitter.emit('payment_method.added', paymentMethod);

    return paymentMethod;
  }

  async updatePaymentMethod(
    id: string,
    updates: Partial<PaymentMethod>
  ): Promise<PaymentMethod> {
    const existingMethod = await this.store.get(id);
    if (!existingMethod) {
      throw new Error('Payment method not found');
    }

    const updatedMethod = {
      ...existingMethod,
      ...updates,
      updatedAt: new Date()
    };

    await this.store.save(updatedMethod);
    await this.eventEmitter.emit('payment_method.updated', updatedMethod);

    return updatedMethod;
  }

  async setDefaultMethod(
    customerId: string,
    methodId: string
  ): Promise<PaymentMethod> {
    await this.unsetDefaultMethod(customerId);

    const method = await this.store.get(methodId);
    if (!method) {
      throw new Error('Payment method not found');
    }

    const updatedMethod = await this.updatePaymentMethod(methodId, {
      isDefault: true
    });

    await this.eventEmitter.emit('payment_method.default_updated', updatedMethod);
    return updatedMethod;
  }

  async removePaymentMethod(id: string): Promise<void> {
    const method = await this.store.get(id);
    if (!method) {
      throw new Error('Payment method not found');
    }

    if (method.isDefault) {
      throw new Error('Cannot remove default payment method');
    }

    await this.store.delete(id);
    await this.eventEmitter.emit('payment_method.removed', method);
  }

  async getCustomerPaymentMethods(
    customerId: string
  ): Promise<PaymentMethod[]> {
    return this.store.getByCustomer(customerId);
  }

  async verifyPaymentMethod(id: string): Promise<boolean> {
    const method = await this.store.get(id);
    if (!method) {
      throw new Error('Payment method not found');
    }

    // Implement provider-specific verification
    // This is a placeholder implementation
    return !method.isExpired;
  }

  async handleExpiredMethods(): Promise<void> {
    const expiredMethods = await this.store.findExpired();
    
    for (const method of expiredMethods) {
      await this.updatePaymentMethod(method.id, { isExpired: true });
      await this.eventEmitter.emit('payment_method.expired', method);
    }
  }

  private async unsetDefaultMethod(customerId: string): Promise<void> {
    const currentDefault = await this.store.getDefaultMethod(customerId);
    if (currentDefault) {
      await this.updatePaymentMethod(currentDefault.id, { isDefault: false });
    }
  }

  private calculateExpiryDate(details: PaymentMethodDetails): Date | undefined {
    if (details.expiryMonth && details.expiryYear) {
      return new Date(details.expiryYear, details.expiryMonth - 1, 1);
    }
    return undefined;
  }
}