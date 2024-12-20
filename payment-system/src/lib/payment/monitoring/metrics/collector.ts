// src/lib/payment/monitoring/metrics/collector.ts
export interface MetricValue {
  value: number;
  timestamp: Date;
  labels?: Record<string, string>;
}

export class MetricsCollector {
  private metrics: Map<string, MetricValue[]> = new Map();

  record(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    this.metrics.get(name)!.push({
      value,
      timestamp: new Date(),
      labels
    });
  }

  getMetric(name: string): MetricValue[] {
    return this.metrics.get(name) || [];
  }

  getAllMetrics(): Record<string, MetricValue[]> {
    const result: Record<string, MetricValue[]> = {};
    for (const [name, values] of this.metrics) {
      result[name] = values;
    }
    return result;
  }

  clearMetrics(): void {
    this.metrics.clear();
  }
}
