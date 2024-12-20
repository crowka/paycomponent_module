// src/lib/payment/compliance/audit.manager.ts
import { AuditLog } from './types';
import { EventEmitter } from '../events/event.emitter';

export class AuditManager {
  private logs: AuditLog[] = [];

  constructor(private eventEmitter: EventEmitter) {}

  async logAction(
    action: string,
    entityType: string,
    entityId: string,
    userId: string,
    changes?: Record<string, any>,
    metadata?: Record<string, any>
  ): Promise<AuditLog> {
    const log: AuditLog = {
      id: uuidv4(),
      action,
      entityType,
      entityId,
      userId,
      timestamp: new Date(),
      changes,
      metadata
    };

    this.logs.push(log);
    await this.eventEmitter.emit('audit.action_logged', log);

    return log;
  }

  async getLogs(
    options: {
      entityType?: string;
      entityId?: string;
      userId?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    }
  ): Promise<AuditLog[]> {
    let filtered = this.logs;

    if (options.entityType) {
      filtered = filtered.filter(log => log.entityType === options.entityType);
    }

    if (options.entityId) {
      filtered = filtered.filter(log => log.entityId === options.entityId);
    }

    if (options.userId) {
      filtered = filtered.filter(log => log.userId === options.userId);
    }

    if (options.startDate) {
      filtered = filtered.filter(log => log.timestamp >= options.startDate!);
    }

    if (options.endDate) {
      filtered = filtered.filter(log => log.timestamp <= options.endDate!);
    }

    const start = options.offset || 0;
    const end = options.limit ? start + options.limit : undefined;

    return filtered.slice(start, end);
  }
}