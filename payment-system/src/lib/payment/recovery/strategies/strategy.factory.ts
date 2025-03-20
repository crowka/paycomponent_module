// src/lib/payment/recovery/strategies/strategy.factory.ts
import { RecoveryStrategy } from './recovery-strategy';
import { NetworkRecoveryStrategy } from './network.strategy';
import { TimeoutRecoveryStrategy } from './timeout.strategy';
import { GeneralRecoveryStrategy } from './general.strategy';

export interface RecoveryStrategyOptions {
  providerName: string;
  providerConfig: any;
  timeoutMaxWaitTime?: number;
}

/**
 * Factory for creating and combining recovery strategies
 */
export class RecoveryStrategyFactory {
  /**
   * Create a default set of recovery strategies
   */
  static createDefaultStrategies(options: RecoveryStrategyOptions): RecoveryStrategy[] {
    const { providerName, providerConfig, timeoutMaxWaitTime } = options;
    
    return [
      // Specific strategies first (order matters)
      new NetworkRecoveryStrategy(providerName, providerConfig),
      new TimeoutRecoveryStrategy(providerName, providerConfig, {
        maxWaitTime: timeoutMaxWaitTime
      }),
      
      // General fallback strategy last
      new GeneralRecoveryStrategy(providerName, providerConfig)
    ];
  }

  /**
   * Create a single recovery strategy of the specified type
   */
  static createStrategy(
    type: 'network' | 'timeout' | 'general',
    options: RecoveryStrategyOptions
  ): RecoveryStrategy {
    const { providerName, providerConfig, timeoutMaxWaitTime } = options;
    
    switch (type) {
      case 'network':
        return new NetworkRecoveryStrategy(providerName, providerConfig);
      
      case 'timeout':
        return new TimeoutRecoveryStrategy(providerName, providerConfig, {
          maxWaitTime: timeoutMaxWaitTime
        });
      
      case 'general':
        return new GeneralRecoveryStrategy(providerName, providerConfig);
      
      default:
        throw new Error(`Unknown recovery strategy type: ${type}`);
    }
  }
}
