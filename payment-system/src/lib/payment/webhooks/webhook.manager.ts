// src/lib/payment/webhooks/webhook.manager.ts
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { WebhookEvent, WebhookEndpoint, WebhookEventType } from './types';
import { WebhookStore } from './webhook.store';
import { EventEmitter } from './event.emitter';

export class WebhookManager {
  constructor(
    private store: WebhookStore,
    private eventEmitter: EventEmitter
  ) {
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.eventEmitter.on('*', async (eventType: string, data: any) => {
      await this.processEvent(eventType as WebhookEventType, data);
    });
  }

  async registerEndpoint(
    url: string,
    events: WebhookEventType[],
    metadata?: Record<string, any>
  ): Promise<WebhookEndpoint> {
    const endpoint: WebhookEndpoint = {
      id: uuidv4(),
      url,
      secret: this.generateSecret(),
      active: true,
      events,
      metadata,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await this.store.saveEndpoint(endpoint);
    return endpoint;
  }

  async processEvent(type: WebhookEventType, data: any): Promise<void> {
    const endpoints = await this.store.getEndpointsByEvent(type);

    const event: WebhookEvent = {
      id: uuidv4(),
      type,
      data,
      timestamp: new Date(),
      signature: ''
    };

    for (const endpoint of endpoints) {
      if (endpoint.active) {
        event.signature = this.signPayload(event, endpoint.secret);
        await this.sendWebhook(endpoint, event);
      }
    }
  }

  private async sendWebhook(endpoint: WebhookEndpoint, event: WebhookEvent): Promise<void> {
    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': event.signature,
          'X-Webhook-ID': event.id
        },
        body: JSON.stringify(event)
      });

      if (!response.ok) {
        throw new Error(`Webhook delivery failed: ${response.statusText}`);
      }
    } catch (error) {
      // Log error and potentially retry
      console.error(`Webhook delivery failed for endpoint ${endpoint.id}:`, error);
      await this.handleWebhookFailure(endpoint, event, error);
    }
  }

  verifySignature(payload: string, signature: string, secret: string): boolean {
    const expectedSignature = this.generateSignature(payload, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  private generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private signPayload(event: WebhookEvent, secret: string): string {
    const payload = JSON.stringify(event);
    return this.generateSignature(payload, secret);
  }

  private generateSignature(payload: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  private async handleWebhookFailure(
    endpoint: WebhookEndpoint,
    event: WebhookEvent,
    error: Error
  ): Promise<void> {
    // Implement retry logic or store failed webhooks
    await this.store.saveFailedWebhook({
      endpoint,
      event,
      error: error.message,
      timestamp: new Date()
    });
  }
}