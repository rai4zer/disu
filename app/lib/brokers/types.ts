export type BrokerProvider = "nordnet" | "avanza";

export type ConnectionStatus = "not_connected" | "pending" | "connected" | "error";

export type BrokerConnection = {
  id: string;
  userId: string;
  broker: BrokerProvider;
  status: ConnectionStatus;
  externalAccountId: string | null;
  consentExpiresAt: string | null;
  lastSyncedAt: string | null;
  errorCode: string | null;
  createdAt: string;
};

export type Position = {
  id: string;
  connectionId: string;
  symbol: string;
  isin: string;
  name: string;
  quantity: number;
  avgCost: number;
  currency: string;
  marketValue: number;
  asOf: string;
};

export type NormalizedPosition = Omit<Position, "id" | "connectionId">;

export type BrokerSyncResult = {
  connection: BrokerConnection;
  positions: Position[];
};

export type BrokerAdapter = {
  connect: (userId: string) => Promise<Pick<BrokerConnection, "externalAccountId" | "consentExpiresAt">>;
  fetchPositions: (connection: BrokerConnection) => Promise<NormalizedPosition[]>;
};
