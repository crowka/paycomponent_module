// src/tests/integration/event.integration.test.ts
import { EventProcessor } from '../../lib/payment/events/event.processor';

describe('Event Integration Tests', () => {
  let eventStore: EventStore;
  let eventProcessor: EventProcessor;
  let processedEvents: string[] = [];

  beforeEach(() => {
    eventStore = new EventStore();
    eventProcessor = new EventProcessor(eventStore);
    processedEvents = [];

    // Register test handler
    eventProcessor.registerHandler('test.event', async (data) => {
      processedEvents.push(data.id);
    });
  });

  test('event processing workflow', async () => {
    // Save test event
    const event = await eventStore.saveEvent({
      type: 'test.event',
      data: { id: '123' },
      timestamp: new Date()
    });

    // Process events
    await eventProcessor.processEvents();

    // Verify processing
    expect(processedEvents).toContain('123');
    const processedEvent = (await eventStore.getUnprocessedEvents())
      .find(e => e.id === event.id);
    expect(processedEvent?.processed).toBe(true);
  });
});
