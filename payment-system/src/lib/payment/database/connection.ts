// src/lib/payment/database/connection.ts
import { Pool, PoolConfig } from 'pg';
import { PaymentLogger } from '../utils/logger';

export class DatabaseConnection {
  private static instance: DatabaseConnection;
  private pool: Pool;
  private logger: PaymentLogger;

  private constructor(config: PoolConfig) {
    this.logger = new PaymentLogger('info', 'DatabaseConnection');
    this.pool = new Pool(config);
    
    // Set up error handling for the pool
    this.pool.on('error', (err) => {
      this.logger.error('Unexpected database pool error', { error: err });
    });
    
    this.logger.info('Database connection pool initialized');
  }

  static getInstance(config?: PoolConfig): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      if (!config) {
        config = {
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || '5432'),
          database: process.env.DB_NAME || 'payment_system',
          user: process.env.DB_USER || 'postgres',
          password: process.env.DB_PASSWORD || '',
          max: parseInt(process.env.DB_POOL_SIZE || '10'),
          idleTimeoutMillis: 30000
        };
      }
      
      DatabaseConnection.instance = new DatabaseConnection(config);
    }
    
    return DatabaseConnection.instance;
  }

  getPool(): Pool {
    return this.pool;
  }

  async query(text: string, params: any[] = []): Promise<any> {
    const start = Date.now();
    
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      this.logger.debug('Executed query', { 
        duration,
        rowCount: result.rowCount
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.logger.error('Query error', { 
        error, 
        duration,
        query: text
      });
      
      throw error;
    }
  }

  async getClient() {
    const client = await this.pool.connect();
    const query = client.query;
    const release = client.release;
    
    // Override client.query to log queries
    client.query = (...args: any[]) => {
      const start = Date.now();
      const result = query.apply(client, args);
      
      result.then(() => {
        const duration = Date.now() - start;
        this.logger.debug('Client query executed', { duration });
      }).catch(err => {
        this.logger.error('Client query error', { error: err });
      });
      
      return result;
    };
    
    // Override client.release to return to pool
    client.release = () => {
      client.query = query;
      client.release = release;
      return release.apply(client);
    };
    
    return client;
  }

  async close(): Promise<void> {
    await this.pool.end();
    this.logger.info('Database connection pool closed');
  }
}
