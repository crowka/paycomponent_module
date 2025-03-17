// src/lib/payment/utils/encryption.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Get encryption key from environment or generate a random one
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 
  Buffer.from(randomBytes(32)).toString('base64');

// Algorithm used for encryption
const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypts sensitive data
 */
export async function encrypt(data: any): Promise<string> {
  try {
    // Generate initialization vector
    const iv = randomBytes(16);
    
    // Create cipher
    const cipher = createCipheriv(
      ALGORITHM, 
      Buffer.from(ENCRYPTION_KEY, 'base64'), 
      iv
    );
    
    // Encrypt data
    const encrypted = Buffer.concat([
      cipher.update(typeof data === 'string' ? data : JSON.stringify(data), 'utf8'),
      cipher.final()
    ]);

    // Get authentication tag
    const authTag = cipher.getAuthTag();

    // Combine IV, auth tag, and encrypted data for storage
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypts sensitive data
 */
export async function decrypt(encryptedData: string): Promise<any> {
  try {
    // Convert base64 string to buffer
    const buffer = Buffer.from(encryptedData, 'base64');
    
    // Extract parts
    const iv = buffer.slice(0, 16);
    const authTag = buffer.slice(16, 32);
    const encrypted = buffer.slice(32);

    // Create decipher
    const decipher = createDecipheriv(
      ALGORITHM, 
      Buffer.from(ENCRYPTION_KEY, 'base64'), 
      iv
    );
    
    // Set auth tag
    decipher.setAuthTag(authTag);

    // Decrypt data
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);

    // Parse result
    return JSON.parse(decrypted.toString('utf8'));
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt data');
  }
}
