// src/lib/payment/compliance/audit.manager.ts
import { v4 as uuidv4 } from 'uuid';
import { AuditLog } from './types';
import { EventEmitter } from '../events/event.emitter';
import { PaymentLogger } from '../utils/logger';
import { errorHandler, ErrorCode } from '../utils/error';

export class AuditManager {
  private logs: AuditLog[] = [];
  private logger: PaymentLogger;
  
  constructor(
    private eventEmitter: EventEmitter,
    private connection?: any // Optional database connection
  ) {
    this.logger = new PaymentLogger('info', 'AuditManager');
  }

  async logAction(
    action: string,
    entityType: string,
    entityId: string,
    userId: string,
    changes?: Record<string, any>,
    metadata?: Record<string, any>
  ): Promise<AuditLog> {
    try {
      const auditLog: AuditLog = {
        id: uuidv4(),
        action,
        entityType,
        entityId,
        userId,
        timestamp: new Date(),
        changes,
        metadata: {
          ...metadata,
          ip: metadata?.ip || 'unknown',
          userAgent: metadata?.userAgent || 'unknown'
        }
      };
      
      this.logger.info(`Audit: ${action}`, {
        entityType,
        entityId,
        userId
      });
      
      // Store log in memory (for testing)
      this.logs.push(auditLog);
      
      // Store log in database if available
      if (this.connection) {
        await this.saveToDatabase(auditLog);
      }
      
      // Emit event for audit logging
      try {
        await this.eventEmitter.emit('audit.action_logged', auditLog);
      } catch (error) {
        this.logger.warn('Failed to emit audit event', { error });
        // Don't fail the operation if event emission fails
      }
      
      return auditLog;
    } catch (error) {
      this.logger.error('Failed to log audit action', {
        error,
        action,
        entityType,
        entityId
      });
      
      throw errorHandler.wrapError(
        error,
        'Failed to log audit action',
        ErrorCode.INTERNAL_ERROR
      );
    }
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
    } = {}
  ): Promise<AuditLog[]> {
    try {
      // If database connection is available, query database
      if (this.connection) {
        return this.getLogsFromDatabase(options);
      }
      
      // Otherwise, filter in-memory logs
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

      // Sort by timestamp descending (newest first)
      filtered = filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      const start = options.offset || 0;
      const end = options.limit ? start + options.limit : undefined;

      return filtered.slice(start, end);
    } catch (error) {
      this.logger.error('Failed to retrieve audit logs', {
        error,
        options
      });
      
      throw errorHandler.wrapError(
        error,
        'Failed to retrieve audit logs',
        ErrorCode.DATABASE_ERROR
      );
    }
  }

  async generateReport(options: {
    startDate: Date;
    endDate: Date;
    entityType?: string;
    format?: 'json' | 'csv' | 'pdf';
  }): Promise<any> {
    try {
      const { startDate, endDate, entityType, format = 'json' } = options;
      
      // Get logs for the report
      const logs = await this.getLogs({
        startDate,
        endDate,
        entityType
      });
      
      // Format according to requested output
      switch (format) {
        case 'csv':
          return this.formatLogsAsCsv(logs);
        case 'pdf':
          return this.formatLogsAsPdf(logs);
        case 'json':
        default:
          return logs;
      }
    } catch (error) {
      this.logger.error('Failed to generate audit report', {
        error,
        options
      });
      
      throw errorHandler.wrapError(
        error,
        'Failed to generate audit report',
        ErrorCode.INTERNAL_ERROR
      );
    }
  }

  private async saveToDatabase(log: AuditLog): Promise<void> {
    const query = `
      INSERT INTO audit_logs (
        id, action, entity_type, entity_id, user_id, 
        changes, metadata, timestamp
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;
    
    const values = [
      log.id,
      log.action,
      log.entityType,
      log.entityId,
      log.userId,
      JSON.stringify(log.changes || {}),
      JSON.stringify(log.metadata || {}),
      log.timestamp
    ];
    
    await this.connection.query(query, values);
  }

  private async getLogsFromDatabase(options: {
    entityType?: string;
    entityId?: string;
    userId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<AuditLog[]> {
    let query = `
      SELECT * FROM audit_logs
      WHERE 1=1
    `;
    
    const values: any[] = [];
    let paramIndex = 1;
    
    if (options.entityType) {
      query += ` AND entity_type = $${paramIndex++}`;
      values.push(options.entityType);
    }
    
    if (options.entityId) {
      query += ` AND entity_id = $${paramIndex++}`;
      values.push(options.entityId);
    }
    
    if (options.userId) {
      query += ` AND user_id = $${paramIndex++}`;
      values.push(options.userId);
    }
    
    if (options.startDate) {
      query += ` AND timestamp >= $${paramIndex++}`;
      values.push(options.startDate);
    }
    
    if (options.endDate) {
      query += ` AND timestamp <= $${paramIndex++}`;
      values.push(options.endDate);
    }
    
    query += ` ORDER BY timestamp DESC`;
    
    if (options.limit) {
      query += ` LIMIT $${paramIndex++}`;
      values.push(options.limit);
    }
    
    if (options.offset) {
      query += ` OFFSET $${paramIndex++}`;
      values.push(options.offset);
    }
    
    const result = await this.connection.query(query, values);
    
    return result.rows.map((row: any) => ({
      id: row.id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      userId: row.user_id,
      changes: row.changes,
      metadata: row.metadata,
      timestamp: row.timestamp
    }));
  }

  private formatLogsAsCsv(logs: AuditLog[]): string {
    const headers = ['ID', 'Action', 'Entity Type', 'Entity ID', 'User ID', 'Timestamp', 'Changes', 'Metadata'];
    
    const rows = logs.map(log => [
      log.id,
      log.action,
      log.entityType,
      log.entityId,
      log.userId,
      log.timestamp.toISOString(),
      JSON.stringify(log.changes || {}),
      JSON.stringify(log.metadata || {})
    ]);
    
    const csvRows = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ];
    
    return csvRows.join('\n');
  }

  private formatLogsAsPdf(logs: AuditLog[]): Buffer {
    // This is a placeholder - in a real implementation, you'd use a PDF generation library
    this.logger.info('PDF generation would happen here');
    return Buffer.from(JSON.stringify(logs));
  }
}
