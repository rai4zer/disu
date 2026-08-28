import type { BrokerAdapter, BrokerProvider } from "@/app/lib/brokers/types";

const missingAdapter: BrokerAdapter = {
  async connect() {
    throw new Error("Adapter not implemented for selected broker");
  },
  async fetchPositions() {
    throw new Error("Adapter not implemented for selected broker");
  }
};

const adapters: Record<BrokerProvider, BrokerAdapter> = {
  swedbank: missingAdapter,
  seb: missingAdapter,
  handelsbanken: missingAdapter,
  nordea: missingAdapter,
  nordnet: missingAdapter,
  avanza: missingAdapter
};

export function getBrokerAdapter(provider: BrokerProvider): BrokerAdapter {
  return adapters[provider];
}
