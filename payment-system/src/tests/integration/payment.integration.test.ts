/ src/tests/integration/payment.integration.test.ts
import { PaymentService } from '../../lib/payment/services/payment.service';
import { WebhookManager } from '../../lib/payment/webhooks/webhook.manager';
import { EventEmitter } from '../../lib/payment/events/event.emitter';

describe('Payment Integration Tests', () => {
  let paymentService: PaymentService;
  let webhookManager: WebhookManager;
  let eventEmitter: EventEmitter;

  beforeEach(() => {
    // Setup test dependencies
    const eventStore = new EventStore();
    eventEmitter = new EventEmitter(eventStore);
    const webhookStore = new WebhookStore();
    webhookManager = new WebhookManager(webhookStore, eventEmitter);
    
    // Initialize payment service with test configuration
    paymentService = new PaymentService(
      testProvider,
      { eventEmitter }
    );
  });

  test('complete payment workflow with webhooks', async () => {
    // Register webhook endpoint
    const endpoint = await webhookManager.registerEndpoint(
      'https://example.com/webhook',
      [WebhookEventType.PAYMENT_SUCCEEDED],
      { test: true }
    );

    // Process payment
    const payment = await paymentService.processPayment({
      amount: 100,
      currency: 'USD',
      paymentMethodId: 'test_pm_123'
    });

    // Verify payment success
    expect(payment.success).toBe(true);

    // Verify webhook was triggered
    const events = await eventStore.getUnprocessedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(WebhookEventType.PAYMENT_SUCCEEDED);
    expect(events[0].data.paymentId).toBe(payment.id);
  });
});