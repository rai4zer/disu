import type { BrokerAdapter, BrokerConnection, NormalizedPosition } from "@/app/lib/brokers/types";

function randomPrice(base: number, variancePct: number): number {
  const shift = (Math.random() * 2 - 1) * variancePct;
  return Number((base * (1 + shift)).toFixed(2));
}

function buildPosition(
  symbol: string,
  isin: string,
  name: string,
  quantity: number,
  avgCost: number,
  latestPrice: number,
  currency: string
): NormalizedPosition {
  return {
    symbol,
    isin,
    name,
    quantity,
    avgCost,
    currency,
    marketValue: Number((quantity * latestPrice).toFixed(2)),
    asOf: new Date().toISOString()
  };
}

export const mockNordnetAdapter: BrokerAdapter = {
  async connect(userId: string) {
    return {
      externalAccountId: `NN-${userId.slice(-4)}-${Math.floor(Math.random() * 9000) + 1000}`,
      consentExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString()
    };
  },

  async fetchPositions(connection: BrokerConnection) {
    const accountSalt = connection.id.length;
    return [
      buildPosition("AAPL", "US0378331005", "Apple Inc.", 22, 183.42, randomPrice(198.2 + accountSalt, 0.02), "USD"),
      buildPosition("NVDA", "US67066G1040", "NVIDIA Corp.", 14, 823.75, randomPrice(857.6 + accountSalt, 0.025), "USD"),
      buildPosition("SEB-A.ST", "SE0000148884", "SEB A", 180, 154.3, randomPrice(160.1 + accountSalt, 0.015), "SEK"),
      buildPosition("XACT-OMXS30", "SE0000693293", "XACT OMXS30", 45, 292.1, randomPrice(301.8 + accountSalt, 0.01), "SEK")
    ];
  }
};
