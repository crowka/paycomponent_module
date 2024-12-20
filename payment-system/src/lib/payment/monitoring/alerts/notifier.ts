// src/lib/payment/monitoring/alerts/notifier.ts
export interface NotificationChannel {
  send(alert: Alert): Promise<void>;
}

export class AlertNotifier {
  private channels: NotificationChannel[] = [];

  addChannel(channel: NotificationChannel): void {
    this.channels.push(channel);
  }

  async sendAlert(alert: Alert): Promise<void> {
    const sendPromises = this.channels.map(channel => channel.send(alert));
    await Promise.all(sendPromises);
  }
}

// Example notification channels
export class EmailNotificationChannel implements NotificationChannel {
  async send(alert: Alert): Promise<void> {
    // Implement email notification logic
    console.log(`Email notification for alert: ${alert.description}`);
  }
}

export class SlackNotificationChannel implements NotificationChannel {
  async send(alert: Alert): Promise<void> {
    // Implement Slack notification logic
    console.log(`Slack notification for alert: ${alert.description}`);
  }
}