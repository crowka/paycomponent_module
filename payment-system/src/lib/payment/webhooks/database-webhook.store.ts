// src/lib/payment/webhooks/database-webhook.store.ts
import { WebhookEndpoint, WebhookEvent, WebhookEventType } from './types';
import { WebhookStore, FailedWebhook } from './webhook.store';
import { Pool } from 'pg';
import { errorHandler, ErrorCode } from '../utils/error';

export class DatabaseWebhookStore extends WebhookStore {
  constructor(private dbPool: Pool) {}

  async saveEndpoint(endpoint: WebhookEndpoint): Promise<void> {
    try {
      const query = `
        INSERT INTO webhook_endpoints (
          id, url, secret, active, events, metadata, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          url = $2,
          secret = $3,
          active = $4,
          events = $5,
          metadata = $6,
          updated_at = $8
      `;

      await this.dbPool.query(query, [
        endpoint.id,
        endpoint.url,
        endpoint.secret,
        endpoint.active,
        JSON.stringify(endpoint.events),
        endpoint.metadata ? JSON.stringify(endpoint.metadata) : null,
        endpoint.createdAt,
        endpoint.updatedAt
      ]);
    } catch (error) {
      throw errorHandler.wrapError(
        error,
        'Failed to save webhook endpoint',
        ErrorCode.DATABASE_ERROR,
        { endpointId: endpoint.id }
      );
    }
  }

  async getEndpoint(id: string): Promise<WebhookEndpoint | null> {
    try {
      const result = await this.dbPool.query(
        'SELECT * FROM webhook_endpoints WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        url: row.url,
        secret: row.secret,
        active: row.active,
        events: row.events,
        metadata: row.metadata,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } catch (error) {
      throw errorHandler.wrapError(
        error,
        'Failed to get webhook endpoint',
        ErrorCode.DATABASE_ERROR,
        { id }
      );
    }
  }

  async getEndpointsByEvent(eventType: WebhookEventType): Promise<WebhookEndpoint[]> {
    try {
      const query = `
        SELECT * FROM webhook_endpoints 
        WHERE active = true AND events @> $1
      `;
      
      const result = await this.dbPool.query(query, [JSON.stringify([eventType])]);
      
      return result.rows.map(row => ({
        id: row.id,
        url: row.url,
        secret: row.secret,
        active: row.active,
        events: row.events,
        metadata: row.metadata,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      throw errorHandler.wrapError(
        error,
        'Failed to get webhook endpoints by event',
        ErrorCode.DATABASE_ERROR,
        { eventType }
      );
    }
  }

  async deleteEndpoint(id: string): Promise<void> {
    try {
      await this.dbPool.query('DELETE FROM webhook_endpoints WHERE id = $1', [id]);
    } catch (error) {
      throw errorHandler.wrapError(
        error,
        'Failed to delete webhook endpoint',
        ErrorCode.DATABASE_ERROR,
        { id }
      );
    }
  }

  async saveFailedWebhook(webhook: FailedWebhook): Promise<void> {
    try {
      const query = `
        INSERT INTO failed_webhooks (
          endpoint_id, event_data, error, timestamp
        ) VALUES ($1, $2, $3, $4)
      `;

      await this.dbPool.query(query, [
        webhook.endpoint.id,
        JSON.stringify(webhook.event),
        webhook.error,
        webhook.timestamp
      ]);
    } catch (error) {
      throw errorHandler.wrapError(
        error,
        'Failed to save failed webhook',
        ErrorCode.DATABASE_ERROR
      );
    }
  }

  async getFailedWebhooks(endpointId: string): Promise<FailedWebhook[]> {
    try {
      const query = `
        SELECT f.*, e.* FROM failed_webhooks f
        JOIN webhook_endpoints e ON f.endpoint_id = e.id
        WHERE f.endpoint_id = $1
        ORDER BY f.timestamp DESC
      `;

      const result = await this.dbPool.query(query, [endpointId]);
      
      return result.rows.map(row => ({
        endpoint: {
          id: row.id,
          url: row.url,
          secret: row.secret,
          active: row.active,
          events: row.events,
          metadata: row.metadata,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        },
        event: row.event_data,
        error: row.error,
        timestamp: row.timestamp
      }));
    } catch (error) {
      throw errorHandler.wrapError(
        error,
        'Failed to get failed webhooks',
        ErrorCode.DATABASE_ERROR,
        { endpointId }
      );
    }
  }
}
