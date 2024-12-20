// src/lib/payment/events/event.emitter.ts
import { EventEmitter as NodeEventEmitter } from 'events';
import { EventStore } from './event.store';

export class EventEmitter extends NodeEventEmitter {
  constructor(private eventStore: EventStore) {
    super();
  }

  async emit(event: string, data: any): Promise<boolean> {
    await this.eventStore.saveEvent({
      type: event,
      data,
      timestamp: new Date()
    });
    
    return super.emit(event, data) || super.emit('*', event, data);
  }
}