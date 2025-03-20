// src/lib/payment/config/database.config.ts
import { DatabaseConnection } from '../database/connection';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize the database connection
export const initializeDatabase = (): DatabaseConnection => {
  const config = {
    host: process.env.DB_HOST || 'zuunosajfzzodzhqtcdi.supabase.co',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: { rejectUnauthorized: false }, // For Supabase connections
    max: parseInt(process.env.DB_POOL_SIZE || '10'),
    idleTimeoutMillis: 30000
  };

  return DatabaseConnection.getInstance(config);
};

// Create a function to get a connection to the database
export const getDbConnection = (): DatabaseConnection => {
  return DatabaseConnection.getInstance();
};
