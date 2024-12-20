// src/lib/payment/events/event.processor.ts
export class EventProcessor {
  private handlers: Map<string, (data: any) => Promise<void>> = new Map();

  constructor(private eventStore: EventStore) {}

  registerHandler(
    eventType: string,
    handler: (data: any) => Promise<void>
  ): void {
    this.handlers.set(eventType, handler);
  }

  async processEvents(): Promise<void> {
    const unprocessedEvents = await this.eventStore.getUnprocessedEvents();

    for (const event of unprocessedEvents) {
      try {
        const handler = this.handlers.get(event.type);
        if (handler) {
          await handler(event.data);
          await this.eventStore.markAsProcessed(event.id);
        }
      } catch (error) {
        await this.eventStore.markAsFailed(event.id, error.message);
      }
    }
  }
}