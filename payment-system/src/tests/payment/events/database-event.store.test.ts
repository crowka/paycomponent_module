// src/tests/payment/events/database-event.store.test.ts
import { DatabaseEventStore } from '../../../lib/payment/events/database-event.store';
import { DatabaseConnection } from '../../../lib/payment/database/connection';
import { initializeDatabase } from '../../../lib/payment/config/database.config';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

describe('DatabaseEventStore', () => {
  let dbConnection: DatabaseConnection;
  let eventStore: DatabaseEventStore;

  beforeAll(() => {
    // Initialize database connection
    dbConnection = initializeDatabase();
    eventStore = new DatabaseEventStore(dbConnection);
  });

  afterAll(async () => {
    // Close database connection
    await dbConnection.close();
  });

  beforeEach(async () => {
    // Clean up events table before each test
    await dbConnection.query('DELETE FROM events WHERE type LIKE $1', ['test.%']);
  });

  test('should save and retrieve events', async () => {
    // Create a test event
    const eventData = {
      type: 'test.event',
      data: { testId: '123', value: 'test-value' },
      timestamp: new Date()
    };

    // Save event
    const savedEvent = await eventStore.saveEvent(eventData);
    
    // Verify event was saved with an ID
    expect(savedEvent.id).toBeDefined();
    expect(savedEvent.type).toBe(eventData.type);
    expect(savedEvent.data).toEqual(eventData.data);
    expect(savedEvent.processed).toBe(false);
    
    // Retrieve event by ID
    const retrievedEvent = await eventStore.getEventById(savedEvent.id);
    
    // Verify retrieved event matches
    expect(retrievedEvent).toBeDefined();
    expect(retrievedEvent!.id).toBe(savedEvent.id);
    expect(retrievedEvent!.type).toBe(eventData.type);
    expect(retrievedEvent!.data).toEqual(eventData.data);
  });

  test('should mark events as processed', async () => {
    // Create and save test event
    const eventData = {
      type: 'test.processing',
      data: { testId: '456' },
      timestamp: new Date()
    };
    
    const savedEvent = await eventStore.saveEvent(eventData);
    
    // Mark as processed
    await eventStore.markAsProcessed(savedEvent.id);
    
    // Retrieve and verify
    const retrievedEvent = await eventStore.getEventById(savedEvent.id);
    
    expect(retrievedEvent).toBeDefined();
    expect(retrievedEvent!.processed).toBe(true);
    expect(retrievedEvent!.error).toBeNull();
    
    // Get unprocessed events
    const unprocessedEvents = await eventStore.getUnprocessedEvents();
    
    // Verify our event is not in unprocessed list
    expect(unprocessedEvents.find(e => e.id === savedEvent.id)).toBeUndefined();
  });

  test('should handle failed events', async () => {
    // Create and save test event
    const eventData = {
      type: 'test.failure',
      data: { testId: '789' },
      timestamp: new Date()
    };
    
    const savedEvent = await eventStore.saveEvent(eventData);
    
    // Mark as failed
    const errorMessage = 'Test error message';
    await eventStore.markAsFailed(savedEvent.id, errorMessage);
    
    // Retrieve and verify
    const retrievedEvent = await eventStore.getEventById(savedEvent.id);
    
    expect(retrievedEvent).toBeDefined();
    expect(retrievedEvent!.processed).toBe(true);
    expect(retrievedEvent!.error).toBe(errorMessage);
    
    // Get failed events
    const failedEvents = await eventStore.getFailedEvents();
    
    // Verify our event is in failed list
    expect(failedEvents.find(e => e.id === savedEvent.id)).toBeDefined();
  });

  test('should handle retry logic', async () => {
    // Create and save test event
    const eventData = {
      type: 'test.retry',
      data: { testId: 'retry-123' },
      timestamp: new Date()
    };
    
    const savedEvent = await eventStore.saveEvent(eventData);
    
    // Mark for retry
    const errorMessage = 'Temporary error';
    const retryCount = 1;
    await eventStore.markForRetry(savedEvent.id, retryCount, errorMessage);
    
    // Retrieve and verify
    const retrievedEvent = await eventStore.getEventById(savedEvent.id);
    
    expect(retrievedEvent).toBeDefined();
    expect(retrievedEvent!.processed).toBe(false);
    expect(retrievedEvent!.error).toBe(errorMessage);
    expect(retrievedEvent!.retryCount).toBe(retryCount);
    expect(retrievedEvent!.nextRetryAt).toBeDefined();
    
    // Since we set nextRetryAt in the future, it shouldn't be in unprocessed yet
    const unprocessedEvents = await eventStore.getUnprocessedEvents();
    expect(unprocessedEvents.find(e => e.id === savedEvent.id)).toBeUndefined();
    
    // Artificially move nextRetryAt to the past
    await dbConnection.query(
      'UPDATE events SET next_retry_at = $1 WHERE id = $2',
      [new Date(Date.now() - 1000), savedEvent.id]
    );
    
    // Now it should be in unprocessed
    const retriedEvents = await eventStore.getUnprocessedEvents();
    expect(retriedEvents.find(e => e.id === savedEvent.id)).toBeDefined();
  });

  test('should prune old processed events', async () => {
    // Create old processed event
    const oldEventData = {
      type: 'test.old',
      data: { testId: 'old-123' },
      timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days ago
    };
    
    const oldEvent = await eventStore.saveEvent(oldEventData);
    await eventStore.markAsProcessed(oldEvent.id);
    
    // Create recent processed event
    const recentEventData = {
      type: 'test.recent',
      data: { testId: 'recent-123' },
      timestamp: new Date()
    };
    
    const recentEvent = await eventStore.saveEvent(recentEventData);
    await eventStore.markAsProcessed(recentEvent.id);
    
    // Prune events older than 3 days
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const prunedCount = await eventStore.pruneProcessedEvents(cutoff);
    
    // Verify prune operation
    expect(prunedCount).toBe(1);
    
    // Verify old event is gone
    const oldRetrieved = await eventStore.getEventById(oldEvent.id);
    expect(oldRetrieved).toBeUndefined();
    
    // Verify recent event still exists
    const recentRetrieved = await eventStore.getEventById(recentEvent.id);
    expect(recentRetrieved).toBeDefined();
  });
});
