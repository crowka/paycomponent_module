export class PaymentContainer {
  private static instance: PaymentContainer;
  private repositories: Map<string, any> = new Map();
  
  static getInstance(): PaymentContainer {
    if (!PaymentContainer.instance) {
      PaymentContainer.instance = new PaymentContainer();
    }
    return PaymentContainer.instance;
  }
  
  registerRepository(key: string, repository: any): void {
    this.repositories.set(key, repository);
  }
  
  getRepository<T>(key: string): T {
    const repository = this.repositories.get(key);
    if (!repository) {
      throw new Error(`Repository ${key} not found`);
    }
    return repository;
  }
}
