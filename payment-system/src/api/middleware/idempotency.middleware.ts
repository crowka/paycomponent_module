// src/api/middleware/idempotency.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { IdempotencyManager } from '../../lib/payment/transaction/utils/idempotency';
import { PaymentLogger } from '../../lib/payment/utils/logger';
import { EventEmitter } from '../../lib/payment/events/event.emitter';
import { errorHandler, ErrorCode } from '../../lib/payment/utils/error';
import { createHash } from 'crypto';

// Create a singleton instance of the logger
const logger = new PaymentLogger('info', 'IdempotencyMiddleware');

// Factory function to create middleware with dependencies
export const createIdempotencyMiddleware = (
  idempotencyManager: IdempotencyManager,
  options: {
    eventEmitter?: EventEmitter;
    headerName?: string;
    excludePaths?: RegExp[];
    requireForMethods?: string[];
    maxBodySize?: number;
    cacheResponseEnabled?: boolean;
    strictBodyValidation?: boolean;
  } = {}
) => {
  const {
    headerName = 'idempotency-key',
    excludePaths = [/^\/webhook/, /^\/health/],
    requireForMethods = ['POST', 'PUT', 'PATCH', 'DELETE'],
    maxBodySize = 1048576, // 1MB default
    cacheResponseEnabled = true,
    strictBodyValidation = true
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Skip idempotency checks for excluded paths
      if (excludePaths.some(pattern => pattern.test(req.path))) {
        return next();
      }

      // Only require idempotency for specified methods
      if (!requireForMethods.includes(req.method)) {
        return next();
      }

      // Get the idempotency key from the header (case-insensitive)
      const idempotencyKey = req.get(headerName) || req.get(headerName.toLowerCase());

      if (!idempotencyKey) {
        logger.warn('Missing idempotency key', {
          method: req.method,
          path: req.path,
          ip: req.ip
        });

        return res.status(400).json({
          error: 'Idempotency key is required for state-changing operations',
          code: ErrorCode.IDEMPOTENCY_ERROR
        });
      }

      // Validate key format (must be at least 8 characters and alphanumeric)
      if (!/^[a-zA-Z0-9_-]{8,}$/.test(idempotencyKey)) {
        logger.warn('Invalid idempotency key format', {
          key: idempotencyKey,
          path: req.path
        });

        return res.status(400).json({
          error: 'Idempotency key must be at least 8 alphanumeric characters',
          code: ErrorCode.IDEMPOTENCY_ERROR
        });
      }

      // Add key to request for later reference
      req['idempotencyKey'] = idempotencyKey;

      // Generate a hash of the request body and path for replay detection
      const requestContext = generateRequestHash(req, maxBodySize);

      // Check if we already have a resource for this key
      const existingResource = await idempotencyManager.getAssociatedResource(idempotencyKey);
      const keyStatus = existingResource ? 
                        await idempotencyManager.getKeyStatus(idempotencyKey) : 
                        null;

      if (existingResource && keyStatus) {
        // If strict body validation is enabled, check for replay attacks with different body
        if (strictBodyValidation && 
            keyStatus.requestHash && 
            requestContext.hash !== keyStatus.requestHash) {
          
          logger.warn('Replay attack detected: same idempotency key with different request body', {
            key: idempotencyKey,
            path: req.path,
            originalHash: keyStatus.requestHash,
            newHash: requestContext.hash
          });

          return res.status(409).json({
            error: 'Request body does not match original request with this idempotency key',
            code: ErrorCode.IDEMPOTENCY_VIOLATION
          });
        }

        logger.info('Found existing resource for idempotency key', {
          key: idempotencyKey,
          resourceId: existingResource.resourceId,
          resourceType: existingResource.resourceType,
          path: req.path
        });

        // Return the cached resource with idempotency markers
        if (cacheResponseEnabled && keyStatus.cachedResponse) {
          logger.info('Returning cached response for idempotency key', {
            key: idempotencyKey,
            resourceId: existingResource.resourceId
          });

          // Set headers to indicate idempotent response
          res.set('X-Idempotency-Replay', 'true');
          
          try {
            const cachedResponse = JSON.parse(keyStatus.cachedResponse);
            return res.status(cachedResponse.statusCode || 200).json(cachedResponse.body);
          } catch (e) {
            // If there's an error parsing cached response, continue with normal flow
            logger.error('Error parsing cached response', { error: e, key: idempotencyKey });
          }
        }

        // If no cached response, return standard idempotent response
        return res.status(200).json({
          data: {
            id: existingResource.resourceId,
            type: existingResource.resourceType
          },
          meta: {
            idempotent: true,
            message: 'Resource was previously created with this idempotency key',
            attempts: keyStatus.attempts || 1
          }
        });
      }

      // Check and lock with proper request body handling
      try {
        await idempotencyManager.checkAndLock(idempotencyKey, {
          path: req.path,
          method: req.method,
          bodyHash: requestContext.hash,
          timestamp: new Date()
        });
      } catch (error) {
        // If it's a duplicate or in-progress request, return appropriate response
        if (error.code === ErrorCode.DUPLICATE_REQUEST) {
          return res.status(409).json({
            error: 'Duplicate request: operation is in progress or already completed',
            code: error.code,
            message: error.message
          });
        }
        throw error;
      }

      // Set up response interception to capture and store results
      const originalSend = res.send;
      const originalJson = res.json;
      const originalEnd = res.end;

      // Override send method
      res.send = function(body: any): Response {
        captureAndStoreResult(req, res, body, idempotencyManager, requestContext);
        return originalSend.apply(res, arguments);
      };

      // Override json method
      res.json = function(body: any): Response {
        captureAndStoreResult(req, res, body, idempotencyManager, requestContext);
        return originalJson.apply(res, arguments);
      };

      // Override end method
      res.end = function(chunk: any): Response {
        if (chunk) {
          captureAndStoreResult(req, res, chunk, idempotencyManager, requestContext);
        }
        return originalEnd.apply(res, arguments);
      };

      // Add cleanup on response finish
      res.on('finish', () => {
        // If request failed, release the lock
        if (res.statusCode >= 400) {
          idempotencyManager.releaseLock(idempotencyKey).catch(error => {
            logger.error('Failed to release idempotency lock', {
              key: idempotencyKey,
              error
            });
          });
        }
      });

      next();
    } catch (error) {
      // Handle other idempotency errors
      if (error.code && error.code.startsWith('IDEMPOTENCY')) {
        logger.warn('Idempotency error', {
          key: req['idempotencyKey'],
          path: req.path,
          error: error.message
        });

        return res.status(400).json({
          error: error.message,
          code: error.code
        });
      }

      // Log other errors
      logger.error('Error in idempotency middleware', {
        path: req.path,
        error
      });

      next(error);
    }
  };
};

// Default middleware instance for backwards compatibility
export const idempotencyMiddleware = createIdempotencyMiddleware(
  new IdempotencyManager()
);

// Helper function to generate a hash from the request for replay detection
function generateRequestHash(req: Request, maxBodySize: number): { hash: string, truncated: boolean } {
  try {
    // Create a hash of the request path and method
    const hasher = createHash('sha256');
    hasher.update(`${req.method}:${req.path}`);
    
    // Only hash the body if it's not too large and exists
    let truncated = false;
    if (req.body) {
      // Normalize the request body for consistent hashing
      const bodyString = typeof req.body === 'string' 
        ? req.body 
        : JSON.stringify(sortObjectKeys(req.body));
      
      // Check if body exceeds max size
      if (bodyString.length > maxBodySize) {
        // Only hash a portion of very large bodies
        hasher.update(bodyString.substring(0, maxBodySize));
        truncated = true;
      } else {
        hasher.update(bodyString);
      }
    }
    
    return {
      hash: hasher.digest('hex'),
      truncated
    };
  } catch (error) {
    logger.warn('Error generating request hash', { error });
    return { 
      hash: `error:${Date.now()}`, 
      truncated: false 
    };
  }
}

// Helper function to sort object keys for consistent serialization
function sortObjectKeys(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => sortObjectKeys(item));
  }
  
  // Handle regular objects
  const sorted: Record<string, any> = {};
  const keys = Object.keys(obj).sort();
  
  for (const key of keys) {
    sorted[key] = sortObjectKeys(obj[key]);
  }
  
  return sorted;
}

// Helper function to capture and store the response
async function captureAndStoreResult(
  req: Request,
  res: Response,
  body: any,
  idempotencyManager: IdempotencyManager,
  requestContext: { hash: string, truncated: boolean }
): Promise<void> {
  // Only process successful responses
  if (res.statusCode >= 200 && res.statusCode < 300) {
    try {
      const idempotencyKey = req['idempotencyKey'];
      if (!idempotencyKey) return;

      // Parse body if needed
      let data = body;
      if (typeof body === 'string') {
        try {
          data = JSON.parse(body);
        } catch (e) {
          // Not JSON, use as is
        }
      }

      // Store the response for future replays if successful
      const responseCache = {
        statusCode: res.statusCode,
        headers: res.getHeaders(),
        body: data,
        timestamp: new Date()
      };

      // Extract resource ID and type using various possible formats
      const extractIdAndType = (data: any): { resourceId?: string; resourceType?: string } => {
        // Direct id/type fields
        if (data?.id && data?.type) {
          return {
            resourceId: data.id,
            resourceType: data.type
          };
        }

        // Nested in data property
        if (data?.data?.id) {
          return {
            resourceId: data.data.id,
            resourceType: data.data.type || getResourceTypeFromPath(req.path)
          };
        }

        // Look for common patterns
        const possibleId = data?.id || data?.transactionId || data?.paymentId || 
                          data?.resourceId || data?.reference;

        if (possibleId) {
          return {
            resourceId: possibleId,
            resourceType: data?.type || getResourceTypeFromPath(req.path)
          };
        }

        // Last resort - generate an ID
        return {
          resourceId: `generated-${Date.now()}`,
          resourceType: getResourceTypeFromPath(req.path)
        };
      };

      const { resourceId, resourceType } = extractIdAndType(data);

      // Associate resource with idempotency key and store the response
      if (resourceId) {
        await idempotencyManager.associateResource(
          idempotencyKey,
          resourceId,
          resourceType || 'unknown',
          JSON.stringify(responseCache),
          requestContext.hash
        );

        logger.info('Associated resource with idempotency key', {
          key: idempotencyKey,
          resourceId,
          resourceType: resourceType || 'unknown'
        });
      }
    } catch (error) {
      logger.error('Error storing idempotency result', { error });
    }
  }
}

// Helper function to extract resource type from URL path
function getResourceTypeFromPath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  // Get last path segment and remove any query parameters
  return segments.length > 0 
    ? segments[segments.length - 1].split('?')[0]
    : 'resource';
}
