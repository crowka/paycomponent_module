// src/lib/payment/events/event.store.ts
export interface StoredEvent {
  id: string;
  type: string;
  data: any;
  timestamp: Date;
  processed?: boolean;
  error?: string;
}

export class EventStore {
  private events: StoredEvent[] = [];

  async saveEvent(event: Omit<StoredEvent, 'id'>): Promise<StoredEvent> {
    const storedEvent: StoredEvent = {
      id: Math.random().toString(36).substring(7),
      ...event
    };
    
    this.events.push(storedEvent);
    return storedEvent;
  }

  async getUnprocessedEvents(): Promise<StoredEvent[]> {
    return this.events.filter(event => !event.processed);
  }

  async markAsProcessed(eventId: string): Promise<void> {
    const event = this.events.find(e => e.id === eventId);
    if (event) {
      event.processed = true;
    }
  }

  async markAsFailed(eventId: string, error: string): Promise<void> {
    const event = this.events.find(e => e.id === eventId);
    if (event) {
      event.error = error;
    }
  }
}
