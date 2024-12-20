// src/lib/payment/monitoring/metrics/aggregator.ts
export class MetricsAggregator {
  private windowSize: number;
  private aggregations: Map<string, AggregatedMetric> = new Map();

  constructor(windowSizeMs: number = 60000) { // Default 1 minute window
    this.windowSize = windowSizeMs;
  }

  addMetric(name: string, value: number, timestamp: Date): void {
    if (!this.aggregations.has(name)) {
      this.aggregations.set(name, new AggregatedMetric(this.windowSize));
    }
    this.aggregations.get(name)!.addValue(value, timestamp);
  }

  getAggregatedMetrics(): Record<string, MetricSummary> {
    const result: Record<string, MetricSummary> = {};
    
    for (const [name, aggregation] of this.aggregations) {
      result[name] = aggregation.getSummary();
    }

    return result;
  }
}

class AggregatedMetric {
  private values: { value: number; timestamp: Date }[] = [];
  private windowSize: number;

  constructor(windowSize: number) {
    this.windowSize = windowSize;
  }

  addValue(value: number, timestamp: Date): void {
    this.cleanup(timestamp);
    this.values.push({ value, timestamp });
  }

  getSummary(): MetricSummary {
    if (this.values.length === 0) {
      return {
        min: 0,
        max: 0,
        avg: 0,
        count: 0,
        sum: 0
      };
    }

    const numbers = this.values.map(v => v.value).sort((a, b) => a - b);
    const sum = numbers.reduce((a, b) => a + b, 0);

    return {
      min: numbers[0],
      max: numbers[numbers.length - 1],
      avg: sum / numbers.length,
      count: numbers.length,
      sum
    };
  }

  private cleanup(currentTimestamp: Date): void {
    const cutoff = new Date(currentTimestamp.getTime() - this.windowSize);
    this.values = this.values.filter(v => v.timestamp >= cutoff);
  }
}