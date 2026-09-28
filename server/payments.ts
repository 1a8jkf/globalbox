/** All providers must confirm on the server. No gateway or real money is used. */
export interface PaymentProvider {
  kind: string;
  confirm(input: {
    reference: string;
    amountCents: number;
  }): Promise<{ reference: string; status: "SIMULATED" }>;
}
export class SimulatedPaymentProvider implements PaymentProvider {
  kind = "SIMULATED";
  async confirm(input: { reference: string; amountCents: number }) {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0)
      throw Error("Invalid simulated payment");
    return { reference: input.reference, status: "SIMULATED" as const };
  }
}
export const payment = new SimulatedPaymentProvider();
