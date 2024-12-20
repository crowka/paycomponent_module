/ src/lib/payment/monitoring/health/checker.ts
import { EventEmitter } from 'events';

export interface HealthStatus {
  status: 'UP' | 'DOWN' | 'DEGRADED';
  components: Record<string, ComponentHealth>;
  timestamp: Date;
}

interface ComponentHealth {
  status: 'UP' | 'DOWN' | 'DEGRADED';
  details?: Record<string, any>;
}

export class HealthChecker extends EventEmitter {
  private indicators: Map<string, () => Promise<ComponentHealth>> = new Map();
  private status: HealthStatus = {
    status: 'UP',
    components: {},
    timestamp: new Date()
  };

  registerIndicator(
    name: string,
    check: () => Promise<ComponentHealth>
  ): void {
    this.indicators.set(name, check);
  }

  async check(): Promise<HealthStatus> {
    const components: Record<string, ComponentHealth> = {};
    let overallStatus: 'UP' | 'DOWN' | 'DEGRADED' = 'UP';

    for (const [name, check] of this.indicators) {
      try {
        components[name] = await check();
        if (components[name].status === 'DOWN') {
          overallStatus = 'DOWN';
        } else if (components[name].status === 'DEGRADED' && overallStatus === 'UP') {
          overallStatus = 'DEGRADED';
        }
      } catch (error) {
        components[name] = { status: 'DOWN', details: { error: error.message } };
        overallStatus = 'DOWN';
      }
    }

    this.status = {
      status: overallStatus,
      components,
      timestamp: new Date()
    };

    this.emit('healthUpdate', this.status);
    return this.status;
  }

  getStatus(): HealthStatus {
    return this.status;
  }
}
