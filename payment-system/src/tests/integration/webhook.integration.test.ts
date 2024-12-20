/ src/tests/integration/webhook.integration.test.ts
import { WebhookManager } from '../../lib/payment/webhooks/webhook.manager';
import { WebhookStore } from '../../lib/payment/webhooks/webhook.store';
import { EventEmitter } from '../../lib/payment/events/event.emitter';
import { EventStore } from '../../lib/payment/events/event.store';
import { WebhookEventType } from '../../lib/payment/webhooks/types';

describe('Webhook Integration Tests', () => {
  let webhookManager: WebhookManager;
  let webhookStore: WebhookStore;
  let eventEmitter: EventEmitter;
  let eventStore: EventStore;

  beforeEach(() => {
    webhookStore = new WebhookStore();
    eventStore = new EventStore();
    eventEmitter = new EventEmitter(eventStore);
    webhookManager = new WebhookManager(webhookStore, eventEmitter);
  });

  test('webhook registration and event processing', async () => {
    // Register webhook endpoint
    const endpoint = await webhookManager.registerEndpoint(
      'https://example.com/webhook',
      [WebhookEventType.PAYMENT_SUCCEEDED],
      { test: true }
    );

    expect(endpoint).toBeDefined();
    expect(endpoint.url).toBe('https://example.com/webhook');
    expect(endpoint.active).toBe(true);

    // Emit event
    await eventEmitter.emit(WebhookEventType.PAYMENT_SUCCEEDED, {
      paymentId: '123',
      amount: 100
    });

    // Verify event processing
    const events = await eventStore.getUnprocessedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(WebhookEventType.PAYMENT_SUCCEEDED);
  });
});