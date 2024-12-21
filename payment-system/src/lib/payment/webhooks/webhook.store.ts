import { WebhookEndpoint, WebhookEvent, WebhookEventType } from '../webhooks/types';

export interface FailedWebhook {
  endpoint: WebhookEndpoint;
  event: WebhookEvent;
  error: string;
  timestamp: Date;
}

export abstract class WebhookStore {
  abstract saveEndpoint(endpoint: WebhookEndpoint): Promise<void>;
  abstract getEndpoint(id: string): Promise<WebhookEndpoint | null>;
  abstract deleteEndpoint(id: string): Promise<void>;
  abstract getEndpointsByEvent(eventType: WebhookEventType): Promise<WebhookEndpoint[]>;
  abstract saveFailedWebhook(webhook: FailedWebhook): Promise<void>;
  abstract getFailedWebhooks(endpointId: string): Promise<FailedWebhook[]>;
}

// In-memory implementation for development and testing
export class InMemoryWebhookStore extends WebhookStore {
  private endpoints: Map<string, WebhookEndpoint> = new Map();
  private failedWebhooks: FailedWebhook[] = [];

  async saveEndpoint(endpoint: WebhookEndpoint): Promise<void> {
    this.endpoints.set(endpoint.id, { ...endpoint });
  }

  async getEndpoint(id: string): Promise<WebhookEndpoint | null> {
    const endpoint = this.endpoints.get(id);
    return endpoint ? { ...endpoint } : null;
  }

  async deleteEndpoint(id: string): Promise<void> {
    this.endpoints.delete(id);
  }

  async getEndpointsByEvent(eventType: WebhookEventType): Promise<WebhookEndpoint[]> {
    return Array.from(this.endpoints.values())
      .filter(endpoint => endpoint.events.includes(eventType))
      .map(endpoint => ({ ...endpoint }));
  }

  async saveFailedWebhook(webhook: FailedWebhook): Promise<void> {
    this.failedWebhooks.push({ ...webhook });
  }

  async getFailedWebhooks(endpointId: string): Promise<FailedWebhook[]> {
    return this.failedWebhooks
      .filter(webhook => webhook.endpoint.id === endpointId)
      .map(webhook => ({ ...webhook }));
  }
}
