import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "@/app/lib/db/supabase";
import { userScoped } from "@/app/lib/db/user-scope";
import type { BrokerAuthProvider } from "@/app/lib/brokers/types";

type SecretRow = {
  id: string;
  user_id: string;
  connection_id: string;
  provider: BrokerAuthProvider;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  token_expires_at: string | null;
  token_scope: string | null;
  created_at: string;
  updated_at: string;
};

export type BrokerConnectionSecret = {
  provider: BrokerAuthProvider;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scope: string | null;
};

function resolveEncryptionKey(): Buffer {
  const raw = process.env.BROKER_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error("Missing required env var: BROKER_TOKEN_ENCRYPTION_KEY");
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  try {
    const base64 = Buffer.from(raw, "base64");
    if (base64.length === 32) {
      return base64;
    }
  } catch {
    // fallback below
  }

  // Backward-compatible fallback for plain strings.
  return createHash("sha256").update(raw, "utf8").digest();
}

function encryptToken(plain: string): string {
  const key = resolveEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decryptToken(payload: string): string {
  const [version, ivB64, tagB64, ciphertextB64] = payload.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !ciphertextB64) {
    throw new Error("Invalid encrypted token payload");
  }

  const key = resolveEncryptionKey();
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const ciphertext = Buffer.from(ciphertextB64, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}

const SECRET_COLUMNS =
  "id,user_id,connection_id,provider,encrypted_access_token,encrypted_refresh_token,token_expires_at,token_scope,created_at,updated_at";

async function findSecret(userId: string, connectionId: string): Promise<SecretRow | null> {
  const rows = await userScoped<SecretRow[]>(userId, "broker_connection_secrets", {
    query: {
      connection_id: eq(connectionId),
      select: SECRET_COLUMNS,
      limit: "1"
    }
  });
  return rows[0] ?? null;
}

export async function upsertConnectionSecret(input: {
  userId: string;
  connectionId: string;
  provider: BrokerAuthProvider;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  scope?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  const existing = await findSecret(input.userId, input.connectionId);
  const access = encryptToken(input.accessToken);
  const refresh = input.refreshToken ? encryptToken(input.refreshToken) : null;

  if (existing) {
    await userScoped<SecretRow[]>(input.userId, "broker_connection_secrets", {
      method: "PATCH",
      query: {
        id: eq(existing.id),
        connection_id: eq(input.connectionId),
        select: SECRET_COLUMNS
      },
      body: {
        provider: input.provider,
        encrypted_access_token: access,
        encrypted_refresh_token: refresh,
        token_expires_at: input.expiresAt ?? null,
        token_scope: input.scope ?? null,
        updated_at: now
      }
    });
    return;
  }

  await userScoped<SecretRow[]>(input.userId, "broker_connection_secrets", {
    method: "POST",
    body: [
      {
        id: `secret_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        connection_id: input.connectionId,
        provider: input.provider,
        encrypted_access_token: access,
        encrypted_refresh_token: refresh,
        token_expires_at: input.expiresAt ?? null,
        token_scope: input.scope ?? null,
        created_at: now,
        updated_at: now
      }
    ]
  });
}

export async function getConnectionSecret(userId: string, connectionId: string): Promise<BrokerConnectionSecret | null> {
  const row = await findSecret(userId, connectionId);
  if (!row) {
    return null;
  }

  return {
    provider: row.provider,
    accessToken: decryptToken(row.encrypted_access_token),
    refreshToken: row.encrypted_refresh_token ? decryptToken(row.encrypted_refresh_token) : null,
    expiresAt: row.token_expires_at,
    scope: row.token_scope
  };
}
