// src/lib/payment/customer/customer.store.ts
export class CustomerStore {
  private customers: Map<string, CustomerProfile> = new Map();

  async save(profile: CustomerProfile): Promise<void> {
    this.customers.set(profile.id, { ...profile });
  }

  async get(id: string): Promise<CustomerProfile | null> {
    const profile = this.customers.get(id);
    return profile ? { ...profile } : null;
  }

  async findByEmail(email: string): Promise<CustomerProfile | null> {
    const profile = Array.from(this.customers.values())
      .find(p => p.email === email);
    return profile ? { ...profile } : null;
  }

  async delete(id: string): Promise<void> {
    this.customers.delete(id);
  }

  async list(options: {
    status?: CustomerStatus;
    riskLevel?: RiskLevel;
    limit?: number;
    offset?: number;
  } = {}): Promise<CustomerProfile[]> {
    let profiles = Array.from(this.customers.values());

    if (options.status) {
      profiles = profiles.filter(p => p.status === options.status);
    }

    if (options.riskLevel) {
      profiles = profiles.filter(p => p.riskLevel === options.riskLevel);
    }

    const start = options.offset || 0;
    const end = options.limit ? start + options.limit : undefined;

    return profiles.slice(start, end).map(p => ({ ...p }));
  }
}