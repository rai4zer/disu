import { randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { SupabaseRequestError, eq, supabaseRequest } from "@/app/lib/db/supabase";
import { assertAcceptablePassword } from "@/app/lib/auth/password-guard";

export type AuthUser = {
  id: string;
  email: string;
  createdAt: string;
};

/**
 * What the account-settings page needs to render the sign-in methods: the user,
 * plus which credentials actually exist. Never the credentials themselves.
 */
export type AccountIdentity = AuthUser & {
  hasPassword: boolean;
  googleLinked: boolean;
};

export type AccountIdentityErrorCode =
  /** No such user — the session outlived the row. */
  | "not_found"
  /** Unlinking Google would leave the account with no way in at all. */
  | "password_required"
  /** That Google account is already attached to a different DISU account. */
  | "google_already_linked"
  /** Another DISU account owns the Google address being linked. */
  | "email_in_use";

export class AccountIdentityError extends Error {
  code: AccountIdentityErrorCode;

  constructor(code: AccountIdentityErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AccountIdentityError";
    this.code = code;
  }
}

type UserRow = {
  id: string;
  email: string;
  // Null for Google-only accounts, which have no password at all (0018).
  password_hash: string | null;
  password_salt: string | null;
  google_sub: string | null;
  created_at: string;
};

const USER_COLUMNS = "id,email,password_hash,password_salt,google_sub,created_at";

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
      select: USER_COLUMNS,
      limit: "1"
    }
  });

  return rows[0] ?? null;
}

async function findUserRowById(userId: string): Promise<UserRow | null> {
  const rows = await supabaseRequest<UserRow[]>("users", {
    query: {
      id: eq(userId),
      select: USER_COLUMNS,
      limit: "1"
    }
  });
  return rows[0] ?? null;
}

async function findUserRowByGoogleSub(googleSub: string): Promise<UserRow | null> {
  const rows = await supabaseRequest<UserRow[]>("users", {
    query: {
      google_sub: eq(googleSub),
      select: USER_COLUMNS,
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
  // Length floor, common-word blocklist and the breach corpus (§2.3). Runs
  // before the existence probe so a rejected password costs no query.
  await assertAcceptablePassword(password, { email: normalizedEmail, context: "register" });

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
  // Google-only account: there is no password to compare against, so password
  // sign-in must always fail rather than fall through to an empty-hash compare.
  if (!record.password_hash || !record.password_salt) {
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

export async function findUserById(userId: string): Promise<AuthUser | null> {
  const record = await findUserRowById(userId);
  return record ? sanitizeUser(record) : null;
}

export type GoogleUserResolution = {
  user: AuthUser;
  /**
   * `created` — brand new passwordless account.
   * `linked` — pre-existing account gained (or had refreshed) its google_sub.
   * `existing` — already linked to this Google account.
   */
  outcome: "created" | "linked" | "existing";
};

async function linkGoogleSub(userId: string, googleSub: string): Promise<void> {
  await supabaseRequest<unknown[]>("users", {
    method: "PATCH",
    query: {
      id: eq(userId)
    },
    body: {
      google_sub: googleSub
    },
    prefer: "return=minimal"
  });
}

/**
 * Resolves a verified Google identity to an app user, creating or linking as
 * needed. The caller must have already confirmed `emailVerified` — this function
 * treats the address as proven and will attach the Google identity to a
 * pre-existing password account with the same email.
 */
export async function findOrCreateUserForGoogle(identity: {
  sub: string;
  email: string;
}): Promise<GoogleUserResolution> {
  const normalizedEmail = normalizeEmail(identity.email);
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("Invalid email.");
  }

  const bySub = await findUserRowByGoogleSub(identity.sub);
  if (bySub) {
    return { user: sanitizeUser(bySub), outcome: "existing" };
  }

  const byEmail = await findUserRowByEmail(normalizedEmail);
  if (byEmail) {
    // Either a password-only account being linked for the first time, or the
    // rarer case of a Google account deleted and recreated on the same verified
    // address, which yields a fresh `sub`. Both re-point the row at the current
    // identity; the verified email is the anchor.
    await linkGoogleSub(byEmail.id, identity.sub);
    return { user: sanitizeUser({ ...byEmail, google_sub: identity.sub }), outcome: "linked" };
  }

  const id = `usr_${randomUUID()}`;
  try {
    const rows = await supabaseRequest<UserRow[]>("users", {
      method: "POST",
      body: [
        {
          id,
          email: normalizedEmail,
          google_sub: identity.sub
        }
      ]
    });
    return { user: sanitizeUser(rows[0]), outcome: "created" };
  } catch (error) {
    // Two concurrent first-time sign-ins race on the email/google_sub unique
    // indexes. The loser re-reads the row the winner just wrote.
    if (error instanceof SupabaseRequestError && error.status === 409) {
      const existing = (await findUserRowByGoogleSub(identity.sub)) ?? (await findUserRowByEmail(normalizedEmail));
      if (existing) {
        return { user: sanitizeUser(existing), outcome: "existing" };
      }
    }
    throw error;
  }
}

function toAccountIdentity(record: UserRow): AccountIdentity {
  return {
    ...sanitizeUser(record),
    hasPassword: Boolean(record.password_hash && record.password_salt),
    googleLinked: Boolean(record.google_sub)
  };
}

/**
 * Which sign-in methods this account has. The booleans are what the settings UI
 * branches on: a Google-only account is offered "set a password", one that has
 * both is offered "change password" and "disconnect Google".
 */
export async function getAccountIdentity(userId: string): Promise<AccountIdentity | null> {
  const record = await findUserRowById(userId);
  return record ? toAccountIdentity(record) : null;
}

/** Re-authentication for an action taken from inside a live session. */
export async function verifyUserPassword(userId: string, password: string): Promise<boolean> {
  const record = await findUserRowById(userId);
  if (!record?.password_hash || !record.password_salt) {
    return false;
  }
  const expected = Buffer.from(record.password_hash, "hex");
  const actual = Buffer.from(hashPassword(password, record.password_salt), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Sets (or replaces) the password on an existing account, with a fresh salt.
 *
 * Authorisation is the caller's job. Two callers are legitimate: someone who
 * proved the *current* password, and a Google-only user whose live session was
 * itself established by Google — which is what lets them add a password without
 * a round trip through the password-reset email.
 */
export async function setUserPassword(userId: string, password: string): Promise<void> {
  const record = await findUserRowById(userId);
  if (!record) {
    throw new AccountIdentityError("not_found", "Account no longer exists.");
  }

  // Same gate as registration and reset, so the floor cannot be walked around by
  // choosing the settings page instead. Throws PasswordPolicyError, which the
  // route turns into a code the form renders in the user's language.
  await assertAcceptablePassword(password, { email: record.email, context: "change" });

  const salt = randomUUID();
  await supabaseRequest<unknown[]>("users", {
    method: "PATCH",
    query: {
      id: eq(userId)
    },
    body: {
      password_hash: hashPassword(password, salt),
      password_salt: salt
    },
    prefer: "return=minimal"
  });
}

export type GoogleLinkOutcome = "linked" | "replaced" | "unchanged";

/**
 * Attaches a verified Google identity to an account the caller is already signed
 * in as. Unlike the sign-in path this does not require the Google address to
 * match the account email — the session is the authorisation — but it does
 * refuse the two shapes that would make a later Google sign-in ambiguous:
 *
 *   - the `sub` already belongs to someone else, so linking it here would give
 *     two accounts one Google identity (the unique index would refuse anyway);
 *   - another account is registered under that Google email, which would send
 *     its owner into *this* account the first time they pressed "Sign in with
 *     Google", because `sub` is matched before email.
 */
export async function linkGoogleToUser(input: {
  userId: string;
  sub: string;
  email: string;
}): Promise<GoogleLinkOutcome> {
  const record = await findUserRowById(input.userId);
  if (!record) {
    throw new AccountIdentityError("not_found", "Account no longer exists.");
  }
  if (record.google_sub === input.sub) {
    return "unchanged";
  }

  const subOwner = await findUserRowByGoogleSub(input.sub);
  if (subOwner && subOwner.id !== input.userId) {
    throw new AccountIdentityError(
      "google_already_linked",
      "That Google account is already connected to another DISU account."
    );
  }

  const normalizedEmail = normalizeEmail(input.email);
  const emailOwner = await findUserRowByEmail(normalizedEmail);
  if (emailOwner && emailOwner.id !== input.userId) {
    throw new AccountIdentityError("email_in_use", "Another DISU account already uses that email address.");
  }

  try {
    await linkGoogleSub(input.userId, input.sub);
  } catch (error) {
    // Lost a race against a concurrent link of the same Google account.
    if (error instanceof SupabaseRequestError && error.status === 409) {
      throw new AccountIdentityError(
        "google_already_linked",
        "That Google account is already connected to another DISU account."
      );
    }
    throw error;
  }

  return record.google_sub ? "replaced" : "linked";
}

/**
 * Detaches Google from an account, refusing to do so while it is the only way
 * in. Without that check the button would be a lockout: the row would keep its
 * email but have no password and no `google_sub`, and the only recovery would be
 * the password-reset email.
 */
export async function unlinkGoogleFromUser(userId: string): Promise<void> {
  const record = await findUserRowById(userId);
  if (!record) {
    throw new AccountIdentityError("not_found", "Account no longer exists.");
  }
  if (!record.google_sub) {
    return;
  }
  if (!record.password_hash || !record.password_salt) {
    throw new AccountIdentityError(
      "password_required",
      "Set a password before disconnecting Google, or you will not be able to sign in."
    );
  }

  await supabaseRequest<unknown[]>("users", {
    method: "PATCH",
    query: {
      id: eq(userId)
    },
    body: {
      google_sub: null
    },
    prefer: "return=minimal"
  });
}
