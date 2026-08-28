import type { BrokerProvider } from "@/app/lib/brokers/types";

export type BrokerIntegration = "tink" | "csv" | "direct_api";

export type BrokerProviderInfo = {
  id: BrokerProvider;
  name: string;
  integration: BrokerIntegration;
  implemented: boolean;
  connectable: boolean;
  note: string;
};

function hasTinkCredentials(): boolean {
  const clientId = process.env.TINK_CLIENT_ID?.trim();
  const clientSecret = process.env.TINK_CLIENT_SECRET?.trim();
  return Boolean(clientId && clientSecret);
}

export function listBrokerProviders(): BrokerProviderInfo[] {
  const tinkReady = hasTinkCredentials();

  return [
    {
      id: "swedbank",
      name: "Swedbank",
      integration: "tink",
      implemented: tinkReady,
      connectable: tinkReady,
      note: tinkReady ? "Connect with bank auth via Tink." : "Tink credentials are required before connect."
    },
    {
      id: "seb",
      name: "SEB",
      integration: "tink",
      implemented: tinkReady,
      connectable: tinkReady,
      note: tinkReady ? "Connect with bank auth via Tink." : "Tink credentials are required before connect."
    },
    {
      id: "handelsbanken",
      name: "Handelsbanken",
      integration: "tink",
      implemented: tinkReady,
      connectable: tinkReady,
      note: tinkReady ? "Connect with bank auth via Tink." : "Tink credentials are required before connect."
    },
    {
      id: "nordea",
      name: "Nordea",
      integration: "tink",
      implemented: tinkReady,
      connectable: tinkReady,
      note: tinkReady ? "Connect with bank auth via Tink." : "Tink credentials are required before connect."
    },
    {
      id: "avanza",
      name: "Avanza",
      integration: "csv",
      implemented: true,
      connectable: true,
      note: "CSV import available now. API connection pending."
    },
    {
      id: "nordnet",
      name: "Nordnet",
      integration: "direct_api",
      implemented: false,
      connectable: false,
      note: "Direct API onboarding is pending."
    }
  ];
}

export function findBrokerProvider(providerId: string): BrokerProviderInfo | null {
  const providers = listBrokerProviders();
  return providers.find((provider) => provider.id === providerId) ?? null;
}
