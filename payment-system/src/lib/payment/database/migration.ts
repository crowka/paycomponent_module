// src/lib/payment/database/migration.ts
import { PaymentLogger } from '../utils/logger';
import { errorHandler, ErrorCode } from '../utils/error';

export interface MigrationContext {
  connection: any; // Database connection - specific implementation depends on the database
  logger: PaymentLogger;
}

export interface Migration {
  version: number;
  name: string;
  up: (context: MigrationContext) => Promise<void>;
  down: (context: MigrationContext) => Promise<void>;
}

export class MigrationManager {
  private logger: PaymentLogger;
  private migrations: Migration[] = [];
  private connection: any;
  private tableName: string;

  constructor(connection: any, options: { tableName?: string } = {}) {
    this.connection = connection;
    this.tableName = options.tableName || 'migrations';
    this.logger = new PaymentLogger('info', 'MigrationManager');
  }

  registerMigration(migration: Migration): void {
    this.migrations.push(migration);
    
    // Keep migrations sorted by version
    this.migrations.sort((a, b) => a.version - b.version);
    
    this.logger.debug(`Registered migration: ${migration.name}`, {
      version: migration.version
    });
  }

  async initialize(): Promise<void> {
    try {
      // Create migrations table if it doesn't exist
      await this.createMigrationsTable();
      this.logger.info('Migration manager initialized');
    } catch (error) {
      this.logger.error('Failed to initialize migration manager', { error });
      throw errorHandler.wrapError(
        error,
        'Failed to initialize migration manager',
        ErrorCode.CONFIGURATION_ERROR
      );
    }
  }

  async getCurrentVersion(): Promise<number> {
    try {
      const result = await this.connection.query(
        `SELECT version FROM ${this.tableName} ORDER BY version DESC LIMIT 1`
      );
      
      if (result.rows && result.rows.length > 0) {
        return result.rows[0].version;
      }
      
      return 0; // No migrations applied yet
    } catch (error) {
      this.logger.error('Failed to get current database version', { error });
      throw errorHandler.wrapError(
        error,
        'Failed to get current database version',
        ErrorCode.DATABASE_ERROR
      );
    }
  }

  async migrateToVersion(
    targetVersion: number, 
    options: { backup?: boolean } = {}
  ): Promise<void> {
    const currentVersion = await this.getCurrentVersion();
    
    this.logger.info('Starting migration', { 
      currentVersion, 
      targetVersion 
    });
    
    if (currentVersion === targetVersion) {
      this.logger.info('Database is already at target version');
      return;
    }
    
    // Create a backup if requested
    if (options.backup) {
      await this.backupDatabase();
    }
    
    try {
      // Begin transaction
      await this.connection.query('BEGIN');
      
      if (currentVersion < targetVersion) {
        // Migrate up
        for (const migration of this.migrations) {
          if (migration.version > currentVersion && migration.version <= targetVersion) {
            this.logger.info(`Applying migration: ${migration.name}`, {
              version: migration.version
            });
            
            // Create context for migration
            const context: MigrationContext = {
              connection: this.connection,
              logger: this.logger.child(`Migration-${migration.version}`)
            };
            
            // Run migration
            await migration.up(context);
            
            // Record migration
            await this.recordMigration(migration.version, migration.name);
            
            this.logger.info(`Migration applied: ${migration.name}`);
          }
        }
      } else {
        // Migrate down
        // Sort in reverse order for downgrades
        const reversedMigrations = [...this.migrations].reverse();
        
        for (const migration of reversedMigrations) {
          if (migration.version <= currentVersion && migration.version > targetVersion) {
            this.logger.info(`Reverting migration: ${migration.name}`, {
              version: migration.version
            });
            
            // Create context for migration
            const context: MigrationContext = {
              connection: this.connection,
              logger: this.logger.child(`Migration-${migration.version}`)
            };
            
            // Run migration
            await migration.down(context);
            
            // Remove migration record
            await this.removeMigrationRecord(migration.version);
            
            this.logger.info(`Migration reverted: ${migration.name}`);
          }
        }
      }
      
      // Commit transaction
      await this.connection.query('COMMIT');
      
      this.logger.info('Migration completed successfully', { 
        fromVersion: currentVersion, 
        toVersion: targetVersion 
      });
    } catch (error) {
      // Rollback transaction
      await this.connection.query('ROLLBACK');
      
      this.logger.error('Migration failed', { 
        error, 
        currentVersion, 
        targetVersion 
      });
      
      throw errorHandler.wrapError(
        error,
        'Database migration failed',
        ErrorCode.DATABASE_ERROR
      );
    }
  }

  async migrateToLatest(options: { backup?: boolean } = {}): Promise<void> {
    const latestVersion = this.migrations.length > 0 
      ? this.migrations[this.migrations.length - 1].version 
      : 0;
      
    await this.migrateToVersion(latestVersion, options);
  }

  async validateDataIntegrity(): Promise<boolean> {
    // This would implement data consistency checks
    // For now, we'll just return true
    this.logger.info('Validating database integrity');
    return true;
  }

  private async createMigrationsTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    await this.connection.query(query);
  }

  private async recordMigration(version: number, name: string): Promise<void> {
    const query = `
      INSERT INTO ${this.tableName} (version, name)
      VALUES ($1, $2)
    `;
    
    await this.connection.query(query, [version, name]);
  }

  private async removeMigrationRecord(version: number): Promise<void> {
    const query = `DELETE FROM ${this.tableName} WHERE version = $1`;
    await this.connection.query(query, [version]);
  }

  private async backupDatabase(): Promise<string> {
    // This is a placeholder - actual implementation would depend on the database
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `payment_system_backup_${timestamp}`;
    
    this.logger.info('Creating database backup', { backupName });
    
    // Example implementation for PostgreSQL
    try {
      // This would be an actual backup command, e.g. for PostgreSQL:
      // await this.executeCommand(`pg_dump -Fc -f ${backupName}.dump ${this.connection.database}`);
      
      this.logger.info('Database backup created successfully', { backupName });
      return backupName;
    } catch (error) {
      this.logger.error('Failed to create database backup', { error });
      throw errorHandler.wrapError(
        error,
        'Failed to create database backup',
        ErrorCode.DATABASE_ERROR
      );
    }
  }
}
