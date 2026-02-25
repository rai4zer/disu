import { randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { SupabaseRequestError, eq, supabaseRequest } from "@/app/lib/db/supabase";

export type AuthUser = {
  id: string;
  email: string;
  createdAt: string;
};

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  created_at: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

function sanitizeUser(record: UserRow): AuthUser {
  return {
    id: record.id,
    email: record.email,
    createdAt: record.created_at
  };
}

async function findUserRowByEmail(email: string): Promise<UserRow | null> {
  const rows = await supabaseRequest<UserRow[]>("users", {
    query: {
      email: eq(email),
      select: "id,email,password_hash,password_salt,created_at",
      limit: "1"
    }
  });

  return rows[0] ?? null;
}

export async function createUser(email: string, password: string): Promise<AuthUser> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("Invalid email.");
  }
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const existing = await findUserRowByEmail(normalizedEmail);
  if (existing) {
    throw new Error("Account already exists.");
  }

  const salt = randomUUID();
  const id = `usr_${randomUUID()}`;

  try {
    const rows = await supabaseRequest<UserRow[]>("users", {
      method: "POST",
      body: [
        {
          id,
          email: normalizedEmail,
          password_hash: hashPassword(password, salt),
          password_salt: salt
        }
      ]
    });
    return sanitizeUser(rows[0]);
  } catch (error) {
    if (error instanceof SupabaseRequestError && error.status === 409) {
      throw new Error("Account already exists.");
    }
    throw error;
  }
}

export async function authenticateUser(email: string, password: string): Promise<AuthUser | null> {
  const normalizedEmail = normalizeEmail(email);
  const record = await findUserRowByEmail(normalizedEmail);
  if (!record) {
    return null;
  }

  const expected = Buffer.from(record.password_hash, "hex");
  const actual = Buffer.from(hashPassword(password, record.password_salt), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  return sanitizeUser(record);
}

export async function findUserByEmail(email: string): Promise<AuthUser | null> {
  const record = await findUserRowByEmail(normalizeEmail(email));
  return record ? sanitizeUser(record) : null;
}
