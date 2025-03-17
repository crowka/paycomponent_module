// src/lib/payment/events/event.emitter.ts

import { EventEmitter as NodeEventEmitter } from 'events';
import { EventStore } from './event.store';

export class EventEmitter extends NodeEventEmitter {
  private eventStore: EventStore;

  constructor(eventStore: EventStore) {
    super();
    this.eventStore = eventStore;
  }

  async emit(event: string, data: any): Promise<boolean> {
    try {
      await this.eventStore.saveEvent({
        type: event,
        data,
        timestamp: new Date(),
        processed: false
      });
      
      return super.emit(event, data) || super.emit('*', event, data);
    } catch (error) {
      console.error(`Failed to emit event ${event}:`, error);
      return false;
    }
  }
}
