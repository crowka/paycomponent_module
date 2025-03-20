// src/scripts/verify-migrations.ts
import { DatabaseConnection } from '../lib/payment/database/connection';
import { MigrationManager } from '../lib/payment/database/migration';
import { initialSchemaMigration } from '../lib/payment/database/001_initial_schema';
import { initializeDatabase } from '../lib/payment/config/database.config';
import { PaymentLogger } from '../lib/payment/utils/logger';

const logger = new PaymentLogger('info', 'MigrationVerifier');

async function verifyMigrations() {
  try {
    // Initialize DB connection
    const dbConnection = initializeDatabase();
    logger.info('Database connection initialized');

    // Create migration manager
    const migrationManager = new MigrationManager(dbConnection);
    await migrationManager.initialize();
    logger.info('Migration manager initialized');

    // Register migrations
    migrationManager.registerMigration(initialSchemaMigration);
    logger.info('Initial schema migration registered');

    // Check current version
    const currentVersion = await migrationManager.getCurrentVersion();
    logger.info(`Current database version: ${currentVersion}`);

    // Run migrations if needed
    if (currentVersion < initialSchemaMigration.version) {
      logger.info(`Migrating database to version ${initialSchemaMigration.version}`);
      await migrationManager.migrateToVersion(initialSchemaMigration.version, { backup: true });
      logger.info('Migration completed');
    } else {
      logger.info('Database is already at the latest version');
    }

    // Verify database integrity
    const isValid = await migrationManager.validateDataIntegrity();
    logger.info(`Database integrity validation: ${isValid ? 'Passed' : 'Failed'}`);

    // Check tables
    const tables = await listTables(dbConnection);
    logger.info('Database tables:', { tables });

    logger.info('Migration verification completed successfully');
  } catch (error) {
    logger.error('Migration verification failed', { error });
  }
}

async function listTables(dbConnection: DatabaseConnection) {
  const result = await dbConnection.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
  `);
  return result.rows.map(row => row.table_name);
}

verifyMigrations();
