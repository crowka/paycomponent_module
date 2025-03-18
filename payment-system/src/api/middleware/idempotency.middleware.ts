// src/api/middleware/idempotency.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { IdempotencyManager } from '../../lib/payment/transaction/utils/idempotency';
import { PaymentLogger } from '../../lib/payment/utils/logger';

// Singleton instance of IdempotencyManager
const idempotencyManager = new IdempotencyManager();
const logger = new PaymentLogger('info', 'IdempotencyMiddleware');

export const idempotencyMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Only process POST, PUT, PATCH requests that require idempotency
  if (
    !['POST', 'PUT', 'PATCH'].includes(req.method) ||
    (req.path && req.path.startsWith('/webhook')) // Webhook endpoints don't need idempotency
  ) {
    return next();
  }

  const idempotencyKey = req.headers['idempotency-key'];

  if (!idempotencyKey) {
    logger.warn('Missing idempotency key', { 
      method: req.method, 
      path: req.path 
    });
    
    return res.status(400).json({ 
      error: 'Idempotency key is required for state-changing operations',
      code: 'idempotency_key_required'
    });
  }

  try {
    // Check for associated resource first
    const existingResource = await idempotencyManager.getAssociatedResource(idempotencyKey as string);
    
    if (existingResource) {
      logger.info('Found existing resource for idempotency key', {
        key: idempotencyKey,
        resourceId: existingResource.resourceId,
        resourceType: existingResource.resourceType
      });
      
      // Return the cached resource
      // This would typically load the resource from a database
      // For now, we'll just send a simplified response
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

    // No existing resource, try to acquire a lock
    await idempotencyManager.checkAndLock(idempotencyKey as string);
    
    // Store the idempotency key in the request for later use
    req['idempotencyKey'] = idempotencyKey;
    
    // Patch the original response methods to capture and store the result
    const originalSend = res.send;
    const originalJson = res.json;
    const originalEnd = res.end;
    
    // Override send method to capture and store the result
    res.send = function(body) {
      captureAndStoreResult(req, res, body);
      return originalSend.apply(res, arguments);
    };
    
    // Override json method
    res.json = function(body) {
      captureAndStoreResult(req, res, body);
      return originalJson.apply(res, arguments);
    };
    
    // Override end method
    res.end = function(chunk) {
      if (chunk) {
        captureAndStoreResult(req, res, chunk);
      }
      return originalEnd.apply(res, arguments);
    };
    
    next();
  } catch (error) {
    if (error.code === 'DUPLICATE_REQUEST') {
      logger.info('Duplicate request detected', { 
        key: idempotencyKey,
        path: req.path 
      });
      
      res.status(409).json({ 
        error: error.message,
        code: error.code
      });
      return;
    }
    
    logger.error('Error in idempotency middleware', { 
      error, 
      key: idempotencyKey 
    });
    
    next(error);
  }
};

// Helper function to capture and store the response
async function captureAndStoreResult(req: Request, res: Response, body: any): Promise<void> {
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
      
      // Extract resource ID and type
      let resourceId = data?.id;
      let resourceType = data?.type;
      
      // Fallbacks if standard fields aren't available
      if (!resourceId && data?.data?.id) {
        resourceId = data.data.id;
      }
      
      if (!resourceType && data?.data?.type) {
        resourceType = data.data.type;
      }
      
      // Use path as fallback resource type
      if (!resourceType) {
        resourceType = req.path.split('/').filter(Boolean).pop() || 'unknown';
      }
      
      // Generate ID if none exists
      if (!resourceId) {
        resourceId = 'generated-' + Date.now();
      }
      
      // Associate resource with idempotency key
      if (resourceId) {
        await idempotencyManager.associateResource(idempotencyKey, resourceId, resourceType);
        
        logger.info('Associated resource with idempotency key', {
          key: idempotencyKey,
          resourceId,
          resourceType
        });
      }
    } catch (error) {
      logger.error('Error storing idempotency result', { error });
    }
  } else {
    // For failures, release the lock so the request can be retried
    try {
      const idempotencyKey = req['idempotencyKey'];
      if (idempotencyKey) {
        await idempotencyManager.releaseLock(idempotencyKey);
      }
    } catch (error) {
      logger.error('Error releasing idempotency lock', { error });
    }
  }
}
