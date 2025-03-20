// src/tests/controllers/webhook.controller.test.ts

import { Request, Response } from 'express';
import { WebhookController } from '../../api/controllers/webhook.controller';
import { WebhookManager } from '../../lib/payment/webhooks/webhook.manager';
import { TransactionManager } from '../../lib/payment/transaction/managers/transaction.manager';
import { InMemoryTransactionStore } from '../../lib/payment/transaction/store/transaction.store';
import { InMemoryWebhookStore } from '../../lib/payment/webhooks/webhook.store';
import { EventEmitter } from '../../lib/payment/events/event.emitter';
import { EventStore } from '../../lib/payment/events/event.store';
import { TransactionStatus, TransactionType } from '../../lib/payment/types/transaction.types';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

// Helper to create a mock express request
const mockRequest = (params: any = {}, body: any = {}, headers: any = {}) => {
  return {
    params,
    body,
    headers,
  } as Request;
};

// Helper to create a mock express response
const mockResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

describe('WebhookController', () => {
  let webhookController: WebhookController;
  let webhookManager: WebhookManager;
  let transactionManager: TransactionManager;
  let transactionStore: InMemoryTransactionStore;
  let webhookStore: InMemoryWebhookStore;
  let eventEmitter: EventEmitter;
  const testWebhookSecret = 'whsec_test_secret_key';
  
  beforeEach(() => {
    // Setup dependencies
    transactionStore = new InMemoryTransactionStore();
    webhookStore = new InMemoryWebhookStore();
    const eventStore = new EventStore();
    eventEmitter = new EventEmitter(eventStore);
    
    // Create webhook manager
    webhookManager = new WebhookManager(webhookStore, eventEmitter);
    
    // Create transaction manager
    transactionManager = new TransactionManager(transactionStore, { eventEmitter });
    
    // Create controller
    webhookController = new WebhookController(
      webhookManager,
      transactionManager,
      {
        stripeWebhookSecret: testWebhookSecret
      }
    );
    
    // Spy on logger methods to avoid console output
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });
  
  afterEach(() => {
    // Restore console methods
    jest.restoreAllMocks();
  });
  
  test('registerWebhook should register a new webhook endpoint', async () => {
    // Arrange
    const webhookData = {
      url: 'https://example.com/webhook',
      events: ['payment.succeeded', 'payment.failed'],
      secret: 'test-secret',
      metadata: { description: 'Test webhook' }
    };
    
    const req = mockRequest({}, webhookData);
    const res = mockResponse();
    
    // Act
    await webhookController.registerWebhook(req, res);
    
    // Assert
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        webhook: expect.objectContaining({
          url: webhookData.url,
          events: webhookData.events
        })
      })
    );
    
    // Verify webhook was stored
    const webhooks = await webhookManager.getEndpoints();
    expect(webhooks.length).toBe(1);
    expect(webhooks[0].url).toBe(webhookData.url);
  });
  
  test('registerWebhook should validate URL format', async () => {
    // Arrange
    const webhookData = {
      url: 'invalid-url', // Invalid URL format
      events: ['payment.succeeded', 'payment.failed'],
      secret: 'test-secret'
    };
    
    const req = mockRequest({}, webhookData);
    const res = mockResponse();
    
    // Act
    await webhookController.registerWebhook(req, res);
    
    // Assert
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'invalid_url'
        })
      })
    );
    
    // Verify no webhook was stored
    const webhooks = await webhookManager.getEndpoints();
    expect(webhooks.length).toBe(0);
  });
  
  test('getWebhooks should return all webhook endpoints', async () => {
    // Arrange
    // Register some test webhooks
    const webhooks = [
      {
        url: 'https://example.com/webhook1',
        events: ['payment.succeeded']
      },
      {
        url: 'https://example.com/webhook2',
        events: ['payment.failed']
      }
    ];
    
    for (const webhook of webhooks) {
      await webhookManager.registerEndpoint(webhook.url, webhook.events);
    }
    
    const req = mockRequest();
    const res = mockResponse();
    
    // Act
    await webhookController.getWebhooks(req, res);
    
    // Assert
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        webhooks: expect.arrayContaining([
          expect.objectContaining({
            url: webhooks[0].url,
            events: webhooks[0].events
          }),
          expect.objectContaining({
            url: webhooks[1].url,
            events: webhooks[1].events
          })
        ])
      })
    );
    expect((res.json as jest.Mock).mock.calls[0][0].webhooks.length).toBe(2);
  });
  
  test('getWebhook should return a single webhook by ID', async () => {
    // Arrange
    // Register a test webhook
    const webhookData = {
      url: 'https://example.com/webhook',
      events: ['payment.succeeded', 'payment.failed']
    };
    
    const webhook = await webhookManager.registerEndpoint(
      webhookData.url,
      webhookData.events
    );
    
    const req = mockRequest({ id: webhook.id });
    const res = mockResponse();
    
    // Act
    await webhookController.getWebhook(req, res);
    
    // Assert
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        webhook: expect.objectContaining({
          id: webhook.id,
          url: webhookData.url,
          events: webhookData.events
        })
      })
    );
  });
  
  test('getWebhook should return 404 for non-existent webhook', async () => {
    // Arrange
    const req = mockRequest({ id: 'non-existent-id' });
    const res = mockResponse();
    
    // Act
    await webhookController.getWebhook(req, res);
    
    // Assert
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'webhook_not_found'
        })
      })
    );
  });
  
  test('updateWebhook should update a webhook', async () => {
    // Arrange
    // Register a test webhook
    const webhookData = {
      url: 'https://example.com/webhook',
      events: ['payment.succeeded']
    };
    
    const webhook = await webhookManager.registerEndpoint(
      webhookData.url,
      webhookData.events
    );
    
    // Update data
    const updateData = {
      url: 'https://example.com/updated-webhook',
      events: ['payment.succeeded', 'payment.failed'],
      active: true
    };
    
    const req = mockRequest({ id: webhook.id }, updateData);
    const res = mockResponse();
    
    // Act
    await webhookController.updateWebhook(req, res);
    
    // Assert
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        webhook: expect.objectContaining({
          id: webhook.id,
          url: updateData.url,
          events: updateData.events,
          active: updateData.active
        })
      })
    );
    
    // Verify webhook was updated
    const updatedWebhook = await webhookManager.getEndpoint(webhook.id);
    expect(updatedWebhook?.url).toBe(updateData.url);
    expect(updatedWebhook?.events).toEqual(updateData.events);
  });
  
  test('deleteWebhook should delete a webhook', async () => {
    // Arrange
    // Register a test webhook
    const webhookData = {
      url: 'https://example.com/webhook',
      events: ['payment.succeeded']
    };
    
    const webhook = await webhookManager.registerEndpoint(
      webhookData.url,
      webhookData.events
    );
    
    const req = mockRequest({ id: webhook.id });
    const res = mockResponse();
    
    // Act
    await webhookController.deleteWebhook(req, res);
    
    // Assert
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: expect.stringContaining('deleted')
      })
    );
    
    // Verify webhook was deleted
    const deletedWebhook = await webhookManager.getEndpoint(webhook.id);
    expect(deletedWebhook).toBeNull();
  });
  
  test('handleStripeWebhook should process payment_intent.succeeded', async () => {
    // Arrange
    // Create a transaction to be updated by the webhook
    const transactionId = uuidv4();
    const transaction = {
      id: transactionId,
      type: TransactionType.PAYMENT,
      status: TransactionStatus.PROCESSING,
      amount: 100,
      currency: 'USD',
      customerId: 'customer-123',
      paymentMethodId: 'pm-123',
      idempotencyKey: `idem-${Date.now()}`,
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await transactionStore.save(transaction);
    
    // Create webhook event data
    const paymentIntentId = `pi_${uuidv4()}`;
    const eventData = {
      id: `evt_${uuidv4()}`,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: paymentIntentId,
          status: 'succeeded',
          amount: 10000, // In cents
          currency: 'usd',
          metadata: {
            transactionId
          },
          payment_method_types: ['card']
        }
      }
    };
    
    // Create Stripe signature
    const timestamp = Math.floor(Date.now() / 1000);
    const payloadString = JSON.stringify(eventData);
    const signedPayload = `${timestamp}.${payloadString}`;
    const signature = crypto
      .createHmac('sha256', testWebhookSecret)
      .update(signedPayload)
      .digest('hex');
    
    const stripeSignature = `t=${timestamp},v1=${signature}`;
    
    const req = mockRequest({}, eventData, { 'stripe-signature': stripeSignature });
    const res = mockResponse();
    
    // Set up event tracking
    const events: Record<string, any[]> = {};
    webhookManager.on('payment.succeeded', (data) => {
      events['payment.succeeded'] = events['payment.succeeded'] || [];
      events['payment.succeeded'].push(data);
    });
    
    // Act
    await webhookController.handleStripeWebhook(req, res);
    
    // Assert
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ received: true }));
    
    // Verify transaction was updated
    const updatedTransaction = await transactionStore.get(transactionId);
    expect(updatedTransaction?.status).toBe(TransactionStatus.COMPLETED);
    
    // Verify event was emitted
    expect(events['payment.succeeded']).toBeDefined();
    expect(events['payment.succeeded'][0].transactionId).toBe(transactionId);
  });
  
  test('handleStripeWebhook should handle invalid signature', async () => {
    // Arrange
    const eventData = {
      id: `evt_${uuidv4()}`,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: `pi_${uuidv4()}`,
          status: 'succeeded'
        }
      }
    };
    
    // Invalid signature
    const stripeSignature = 't=1234567890,v1=invalid_signature';
    
    const req = mockRequest({}, eventData, { 'stripe-signature': stripeSignature });
    const res = mockResponse();
    
    // Act
    await webhookController.handleStripeWebhook(req, res);
    
    // Assert
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'invalid_signature'
        })
      })
    );
  });
  
  test('handleStripeWebhook should process payment_intent.payment_failed', async () => {
    // Arrange
    // Create a transaction to be updated by the webhook
    const transactionId = uuidv4();
    const transaction = {
      id: transactionId,
      type: TransactionType.PAYMENT,
      status: TransactionStatus.PROCESSING,
      amount: 100,
      currency: 'USD',
      customerId: 'customer-123',
      paymentMethodId: 'pm-123',
      idempotencyKey: `idem-${Date.now()}`,
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await transactionStore.save(transaction);
    
    // Create webhook event data
    const paymentIntentId = `pi_${uuidv4()}`;
    const eventData = {
      id: `evt_${uuidv4()}`,
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: paymentIntentId,
          status: 'failed',
          amount: 10000, // In cents
          currency: 'usd',
          metadata: {
            transactionId
          },
          last_payment_error: {
            code: 'card_declined',
            message: 'Your card was declined',
            decline_code: 'insufficient_funds'
          }
        }
      }
    };
    
    // Create Stripe signature
    const timestamp = Math.floor(Date.now() / 1000);
    const payloadString = JSON.stringify(eventData);
    const signedPayload = `${timestamp}.${payloadString}`;
    const signature = crypto
      .createHmac('sha256', testWebhookSecret)
      .update(signedPayload)
      .digest('hex');
    
    const stripeSignature = `t=${timestamp},v1=${signature}`;
    
    const req = mockRequest({}, eventData, { 'stripe-signature': stripeSignature });
    const res = mockResponse();
    
    // Set up event tracking
    const events: Record<string, any[]> = {};
    webhookManager.on('payment.failed', (data) => {
      events['payment.failed'] = events['payment.failed'] || [];
      events['payment.failed'].push(data);
    });
    
    // Act
    await webhookController.handleStripeWebhook(req, res);
    
    // Assert
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ received: true }));
    
    // Verify transaction was updated
    const updatedTransaction = await transactionStore.get(transactionId);
    expect(updatedTransaction?.status).toBe(TransactionStatus.FAILED);
    
    // Verify event was emitted
    expect(events['payment.failed']).toBeDefined();
    expect(events['payment.failed'][0].transactionId).toBe(transactionId);
  });
});
