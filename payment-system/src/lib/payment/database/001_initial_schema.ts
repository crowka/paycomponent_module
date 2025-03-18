// src/lib/payment/database/migrations/001_initial_schema.ts
import { Migration, MigrationContext } from '../migration';

export const initialSchemaMigration: Migration = {
  version: 1,
  name: 'Initial schema',
  
  up: async (context: MigrationContext): Promise<void> => {
    const { connection, logger } = context;
    
    logger.info('Creating initial database schema');
    
    // Create customers table
    await connection.query(`
      CREATE TABLE customers (
        id UUID PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(255),
        default_currency CHAR(3) NOT NULL DEFAULT 'USD',
        risk_level VARCHAR(10) NOT NULL DEFAULT 'low',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        preferences JSONB NOT NULL DEFAULT '{}',
        limits JSONB NOT NULL DEFAULT '{}',
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create payment_methods table
    await connection.query(`
      CREATE TABLE payment_methods (
        id UUID PRIMARY KEY,
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        provider VARCHAR(50) NOT NULL,
        is_default BOOLEAN NOT NULL DEFAULT false,
        is_expired BOOLEAN NOT NULL DEFAULT false,
        details JSONB NOT NULL,
        metadata JSONB,
        expiry_date TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create transactions table
    await connection.query(`
      CREATE TABLE transactions (
        id UUID PRIMARY KEY,
        type VARCHAR(20) NOT NULL,
        status VARCHAR(30) NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        currency CHAR(3) NOT NULL,
        customer_id UUID NOT NULL REFERENCES customers(id),
        payment_method_id UUID NOT NULL REFERENCES payment_methods(id),
        idempotency_key VARCHAR(255) NOT NULL UNIQUE,
        retry_count INTEGER NOT NULL DEFAULT 0,
        metadata JSONB,
        error JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        failed_at TIMESTAMP
      )
    `);
    
    // Create audit_logs table
    await connection.query(`
      CREATE TABLE audit_logs (
        id UUID PRIMARY KEY,
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id UUID NOT NULL,
        user_id UUID,
        changes JSONB,
        metadata JSONB,
        timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create events table
    await connection.query(`
      CREATE TABLE events (
        id UUID PRIMARY KEY,
        type VARCHAR(100) NOT NULL,
        data JSONB NOT NULL,
        processed BOOLEAN NOT NULL DEFAULT false,
        error TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at TIMESTAMP,
        timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create webhooks table
    await connection.query(`
      CREATE TABLE webhook_endpoints (
        id UUID PRIMARY KEY,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        events JSONB NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create indexes for performance
    await connection.query(`CREATE INDEX idx_transactions_customer_id ON transactions(customer_id)`);
    await connection.query(`CREATE INDEX idx_transactions_status ON transactions(status)`);
    await connection.query(`CREATE INDEX idx_transactions_created_at ON transactions(created_at)`);
    await connection.query(`CREATE INDEX idx_payment_methods_customer_id ON payment_methods(customer_id)`);
    await connection.query(`CREATE INDEX idx_events_processed ON events(processed, next_retry_at)`);
    await connection.query(`CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id)`);
    
    logger.info('Initial schema created successfully');
  },
  
  down: async (context: MigrationContext): Promise<void> => {
    const { connection, logger } = context;
    
    logger.info('Rolling back initial schema');
    
    // Drop tables in reverse order of creation (respect foreign keys)
    await connection.query('DROP TABLE IF EXISTS webhook_endpoints');
    await connection.query('DROP TABLE IF EXISTS events');
    await connection.query('DROP TABLE IF EXISTS audit_logs');
    await connection.query('DROP TABLE IF EXISTS transactions');
    await connection.query('DROP TABLE IF EXISTS payment_methods');
    await connection.query('DROP TABLE IF EXISTS customers');
    
    logger.info('Initial schema rolled back successfully');
  }
};
