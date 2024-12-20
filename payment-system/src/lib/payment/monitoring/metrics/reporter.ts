// src/lib/payment/monitoring/metrics/reporter.ts
import { MetricValue } from './collector';

export interface MetricsReport {
  timestamp: Date;
  metrics: Record<string, MetricSummary>;
  period: {
    start: Date;
    end: Date;
  };
}

interface MetricSummary {
  min: number;
  max: number;
  avg: number;
  count: number;
  sum: number;
  p95?: number;
  p99?: number;
}

export class MetricsReporter {
  generateReport(
    metrics: Record<string, MetricValue[]>,
    startTime: Date,
    endTime: Date
  ): MetricsReport {
    const report: MetricsReport = {
      timestamp: new Date(),
      metrics: {},
      period: {
        start: startTime,
        end: endTime
      }
    };

    for (const [name, values] of Object.entries(metrics)) {
      const filteredValues = values.filter(
        v => v.timestamp >= startTime && v.timestamp <= endTime
      );

      if (filteredValues.length > 0) {
        report.metrics[name] = this.calculateMetricSummary(filteredValues);
      }
    }

    return report;
  }

  private calculateMetricSummary(values: MetricValue[]): MetricSummary {
    const numbers = values.map(v => v.value).sort((a, b) => a - b);
    const sum = numbers.reduce((a, b) => a + b, 0);
    const count = numbers.length;

    return {
      min: numbers[0],
      max: numbers[numbers.length - 1],
      avg: sum / count,
      count,
      sum,
      p95: this.calculatePercentile(numbers, 0.95),
      p99: this.calculatePercentile(numbers, 0.99)
    };
  }

  private calculatePercentile(sortedValues: number[], percentile: number): number {
    const index = Math.ceil(sortedValues.length * percentile) - 1;
    return sortedValues[index];
  }
}