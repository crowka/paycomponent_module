// src/api/middleware/idempotency.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { IdempotencyManager } from '../../lib/payment/transaction/utils/idempotency';
import { PaymentLogger } from '../../lib/payment/utils/logger';
import { EventEmitter } from '../../lib/payment/events/event.emitter';
import { errorHandler, ErrorCode } from '../../lib/payment/utils/error';

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
  } = {}
) => {
  const {
    headerName = 'idempotency-key',
    excludePaths = [/^\/webhook/, /^\/health/],
    requireForMethods = ['POST', 'PUT', 'PATCH', 'DELETE'],
    maxBodySize = 1048576 // 1MB default
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

      // Add key to request for later reference
      req['idempotencyKey'] = idempotencyKey;

      // Check if we already have a resource for this key
      const existingResource = await idempotencyManager.getAssociatedResource(idempotencyKey);

      if (existingResource) {
        logger.info('Found existing resource for idempotency key', {
          key: idempotencyKey,
          resourceId: existingResource.resourceId,
          resourceType: existingResource.resourceType,
          path: req.path
        });

        // Return the cached resource with idempotency markers
        return res.status(200).json({
          data: {
            id: existingResource.resourceId,
            type: existingResource.resourceType
          },
          meta: {
            idempotent: true,
            message: 'Resource was previously created with this idempotency key'
          }
        });
      }

      // Check and lock with proper request body handling
      const requestBody = req.body;
      
      // Don't hash extremely large bodies
      const bodyForHashing = 
        requestBody && 
        JSON.stringify(requestBody).length <= maxBodySize 
          ? requestBody 
          : null;

      await idempotencyManager.checkAndLock(idempotencyKey, bodyForHashing);

      // Set up response interception to capture and store results
      const originalSend = res.send;
      const originalJson = res.json;
      const originalEnd = res.end;

      // Override send method
      res.send = function(body: any): Response {
        captureAndStoreResult(req, res, body, idempotencyManager);
        return originalSend.apply(res, arguments);
      };

      // Override json method
      res.json = function(body: any): Response {
        captureAndStoreResult(req, res, body, idempotencyManager);
        return originalJson.apply(res, arguments);
      };

      // Override end method
      res.end = function(chunk: any): Response {
        if (chunk) {
          captureAndStoreResult(req, res, chunk, idempotencyManager);
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
      // Handle specific idempotency errors
      if (error.code === ErrorCode.DUPLICATE_REQUEST) {
        logger.info('Duplicate request detected', {
          key: req['idempotencyKey'],
          path: req.path
        });

        return res.status(409).json({
          error: error.message,
          code: error.code
        });
      }

      if (error.code === ErrorCode.IDEMPOTENCY_ERROR) {
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

// Helper function to capture and store the response
async function captureAndStoreResult(
  req: Request,
  res: Response,
  body: any,
  idempotencyManager: IdempotencyManager
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

      // Associate resource with idempotency key
      if (resourceId) {
        await idempotencyManager.associateResource(
          idempotencyKey,
          resourceId,
          resourceType || 'unknown'
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
