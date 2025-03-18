// src/lib/payment/database/backup.manager.ts
import { PaymentLogger } from '../utils/logger';
import { errorHandler, ErrorCode } from '../utils/error';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

export class BackupManager {
  private logger: PaymentLogger;
  private backupDir: string;
  private retentionDays: number;
  
  constructor(
    private connection: any,
    options: {
      backupDir?: string;
      retentionDays?: number;
    } = {}
  ) {
    this.logger = new PaymentLogger('info', 'BackupManager');
    this.backupDir = options.backupDir || path.join(process.cwd(), 'backups');
    this.retentionDays = options.retentionDays || 30;
    
    // Ensure backup directory exists
    this.ensureBackupDir();
  }

  async createBackup(
    options: {
      tag?: string;
      includeSchema?: boolean;
      includeData?: boolean;
    } = {}
  ): Promise<string> {
    const {
      tag = 'manual',
      includeSchema = true,
      includeData = true
    } = options;
    
    try {
      // Create timestamp for backup
      const timestamp = new Date().toISOString().replace(/[:.-]/g, '_');
      const backupFileName = `payment_system_${tag}_${timestamp}.dump`;
      const backupPath = path.join(this.backupDir, backupFileName);
      
      this.logger.info('Creating database backup', { 
        backupPath, 
        includeSchema, 
        includeData 
      });
      
      // Get database connection details
      const { database, user, password, host, port } = this.getDatabaseConfig();
      
      // Create backup command (PostgreSQL example)
      const backupOptions = [
        '-Fc', // Custom format
        `-f${backupPath}`,
        `-d${database}`,
        `-U${user}`,
        `-h${host}`,
        `-p${port}`
      ];
      
      if (!includeSchema) {
        backupOptions.push('--data-only');
      }
      
      if (!includeData) {
        backupOptions.push('--schema-only');
      }
      
      // Execute backup command
      await this.executeCommand('pg_dump', backupOptions, { PGPASSWORD: password });
      
      this.logger.info('Backup created successfully', { backupPath });
      
      // Clean up old backups
      await this.cleanupOldBackups();
      
      return backupPath;
    } catch (error) {
      this.logger.error('Failed to create backup', { error });
      throw errorHandler.wrapError(
        error,
        'Failed to create database backup',
        ErrorCode.DATABASE_ERROR
      );
    }
  }
// src/lib/payment/database/backup.manager.ts (continued)
  async restoreBackup(
    backupPath: string,
    options: {
      force?: boolean;
    } = {}
  ): Promise<boolean> {
    const { force = false } = options;
    
    try {
      // Validate backup file exists
      if (!fs.existsSync(backupPath)) {
        throw new Error(`Backup file not found: ${backupPath}`);
      }
      
      this.logger.info('Restoring database from backup', { backupPath });
      
      // Create a backup before restoring if not forced
      if (!force) {
        const preRestoreBackup = await this.createBackup({ tag: 'pre_restore' });
        this.logger.info('Created pre-restore backup', { backupPath: preRestoreBackup });
      }
      
      // Get database connection details
      const { database, user, password, host, port } = this.getDatabaseConfig();
      
      // Create restore command (PostgreSQL example)
      const restoreOptions = [
        `-d${database}`,
        `-U${user}`,
        `-h${host}`,
        `-p${port}`,
        backupPath
      ];
      
      // Execute restore command
      await this.executeCommand('pg_restore', restoreOptions, { PGPASSWORD: password });
      
      this.logger.info('Database restored successfully', { backupPath });
      return true;
    } catch (error) {
      this.logger.error('Failed to restore database', { error, backupPath });
      throw errorHandler.wrapError(
        error,
        'Failed to restore database from backup',
        ErrorCode.DATABASE_ERROR
      );
    }
  }

  async listBackups(): Promise<{ file: string; size: number; date: Date }[]> {
    try {
      const files = await fs.promises.readdir(this.backupDir);
      const backupFiles = files.filter(file => file.endsWith('.dump'));
      
      const backups = await Promise.all(
        backupFiles.map(async (file) => {
          const filePath = path.join(this.backupDir, file);
          const stats = await fs.promises.stat(filePath);
          
          return {
            file,
            size: stats.size,
            date: stats.mtime
          };
        })
      );
      
      // Sort by date, newest first
      return backups.sort((a, b) => b.date.getTime() - a.date.getTime());
    } catch (error) {
      this.logger.error('Failed to list backups', { error });
      throw errorHandler.wrapError(
        error,
        'Failed to list database backups',
        ErrorCode.INTERNAL_ERROR
      );
    }
  }

  private async cleanupOldBackups(): Promise<number> {
    try {
      const backups = await this.listBackups();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
      
      let deletedCount = 0;
      
      for (const backup of backups) {
        if (backup.date < cutoffDate) {
          const filePath = path.join(this.backupDir, backup.file);
          await fs.promises.unlink(filePath);
          deletedCount++;
          
          this.logger.debug('Deleted old backup', { 
            file: backup.file, 
            date: backup.date 
          });
        }
      }
      
      if (deletedCount > 0) {
        this.logger.info(`Cleaned up ${deletedCount} old backups`);
      }
      
      return deletedCount;
    } catch (error) {
      this.logger.error('Failed to clean up old backups', { error });
      // Don't throw, just log the error
      return 0;
    }
  }

  private ensureBackupDir(): void {
    try {
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
        this.logger.info('Created backup directory', { dir: this.backupDir });
      }
    } catch (error) {
      this.logger.error('Failed to create backup directory', { 
        dir: this.backupDir, 
        error 
      });
      throw error;
    }
  }

  private getDatabaseConfig() {
    // This would extract connection details from the connection object
    // This is a simplified example
    return {
      database: process.env.DB_NAME || 'payment_system',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || '5432'
    };
  }

  private executeCommand(
    command: string, 
    args: string[],
    env: Record<string, string> = {}
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args, {
        env: { ...env, ...process.env }
      });
      
      let stderr = '';
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        }
      });
      
      process.on('error', reject);
    });
  }
}
 
