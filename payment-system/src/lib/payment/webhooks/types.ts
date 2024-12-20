// src/lib/payment/webhooks/types.ts
export enum WebhookEventType {
  PAYMENT_SUCCEEDED = 'payment.succeeded',
  PAYMENT_FAILED = 'payment.failed',
  PAYMENT_REFUNDED = 'payment.refunded',
  PAYMENT_DISPUTED = 'payment.disputed',
  METHOD_ADDED = 'payment_method.added',
  METHOD_UPDATED = 'payment_method.updated',
  METHOD_REMOVED = 'payment_method.removed'
}

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  data: Record<string, any>;
  timestamp: Date;
  signature: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  secret: string;
  active: boolean;
  events: WebhookEventType[];
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}