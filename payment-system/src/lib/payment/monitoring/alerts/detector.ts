// src/lib/payment/monitoring/alerts/detector.ts (continuation)
export interface AlertRule {
  name: string;
  condition: (metrics: MetricValue[]) => boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

export interface Alert {
  id: string;
  ruleName: string;
  severity: string;
  description: string;
  timestamp: Date;
  metrics: MetricValue[];
  acknowledged: boolean;
}

export class AlertDetector {
  private rules: AlertRule[] = [];
  private alerts: Alert[] = [];
  private notifier: AlertNotifier;

  constructor(notifier: AlertNotifier) {
    this.notifier = notifier;
  }

  addRule(rule: AlertRule): void {
    this.rules.push(rule);
  }

  async checkRules(metrics: Record<string, MetricValue[]>): Promise<void> {
    for (const rule of this.rules) {
      const metricsForRule = metrics[rule.name] || [];
      
      if (rule.condition(metricsForRule)) {
        const alert: Alert = {
          id: `${rule.name}-${Date.now()}`,
          ruleName: rule.name,
          severity: rule.severity,
          description: rule.description,
          timestamp: new Date(),
          metrics: metricsForRule,
          acknowledged: false
        };

        this.alerts.push(alert);
        await this.notifier.sendAlert(alert);
      }
    }
  }

  getActiveAlerts(): Alert[] {
    return this.alerts.filter(alert => !alert.acknowledged);
  }

  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
    }
  }
}