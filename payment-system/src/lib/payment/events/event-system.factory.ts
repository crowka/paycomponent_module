// src/lib/payment/events/event-system.factory.ts
import { EventEmitter } from './event.emitter';
import { EventStore } from './event.store';
import { DatabaseEventStore } from './database-event.store';
import { EventProcessor } from './event.processor';
import { DatabaseConnection } from '../database/connection';
import { getDbConnection } from '../config/database.config';

// Options for creating the event system
export interface EventSystemOptions {
  processingInterval?: number;
  maxRetries?: number;
  useDatabase?: boolean;
  dbConnection?: DatabaseConnection;
  startProcessor?: boolean;
}

// Factory to create a complete event system
export class EventSystemFactory {
  /**
   * Create a complete event system with emitter, store, and processor
   */
  static createEventSystem(options: EventSystemOptions = {}): {
    eventEmitter: EventEmitter;
    eventStore: EventStore;
    eventProcessor: EventProcessor;
  } {
    const {
      processingInterval = 5000,
      maxRetries = 3,
      useDatabase = true,
      dbConnection,
      startProcessor = false
    } = options;

    // Create appropriate event store
    let eventStore: EventStore;
    if (useDatabase) {
      // Use provided connection or get default
      const conn = dbConnection || getDbConnection();
      eventStore = new DatabaseEventStore(conn);
    } else {
      // Use in-memory store for development/testing
      eventStore = new EventStore();
    }

    // Create event emitter
    const eventEmitter = new EventEmitter(eventStore);

    // Create event processor
    const eventProcessor = new EventProcessor(eventStore, {
      processingInterval,
      maxRetries
    });

    // Start processing events if requested
    if (startProcessor) {
      eventProcessor.startProcessing();
    }

    return {
      eventEmitter,
      eventStore,
      eventProcessor
    };
  }

  /**
   * Create just an event emitter with the appropriate store
   */
  static createEventEmitter(useDatabase: boolean = true): EventEmitter {
    let eventStore: EventStore;
    
    if (useDatabase) {
      eventStore = new DatabaseEventStore(getDbConnection());
    } else {
      eventStore = new EventStore();
    }

    return new EventEmitter(eventStore);
  }
}
