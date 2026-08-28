export type BrokerProvider = "swedbank" | "seb" | "handelsbanken" | "nordea" | "nordnet" | "avanza";

export type ConnectionStatus = "not_connected" | "pending" | "awaiting_account_selection" | "connected" | "error";
export type BrokerAuthProvider = "manual" | "tink";
export type BrokerDataScope = "symbols_only" | "positions_plus";
export type BrokerAccountType = "isk" | "kf" | "af" | "other";

export type BrokerConnection = {
  id: string;
  userId: string;
  broker: BrokerProvider;
  status: ConnectionStatus;
  authProvider: BrokerAuthProvider;
  dataScope: BrokerDataScope;
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

export type BrokerConnectionAccount = {
  id: string;
  connectionId: string;
  providerAccountId: string;
  providerAccountName: string;
  accountType: BrokerAccountType;
  selected: boolean;
};

export type BrokerAdapter = {
  connect: (userId: string) => Promise<Pick<BrokerConnection, "externalAccountId" | "consentExpiresAt">>;
  fetchPositions: (connection: BrokerConnection) => Promise<NormalizedPosition[]>;
};
