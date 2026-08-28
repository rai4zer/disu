import { createHash, randomUUID } from "node:crypto";
import { SupabaseRequestError, eq, supabaseRequest } from "@/app/lib/db/supabase";

export type FeatureRequestStatus = "new" | "planned" | "done" | "rejected";
export type FeatureRequestListFilter = FeatureRequestStatus | "all";

export type FeatureRequest = {
  id: string;
  userId: string | null;
  message: string;
  status: FeatureRequestStatus;
  sourcePage: string | null;
  createdAt: string;
  updatedAt: string;
  votes: number;
  comments: number;
};

export type FeatureRequestComment = {
  id: string;
  featureRequestId: string;
  userId: string | null;
  message: string;
  createdAt: string;
  updatedAt: string;
};

type FeatureRequestRow = {
  id: string;
  user_id: string | null;
  message: string;
  status: string;
  source_page: string | null;
  created_at: string;
  updated_at: string;
};

type FeatureRequestCommentRow = {
  id: string;
  feature_request_id: string;
  user_id: string | null;
  message: string;
  created_at: string;
  updated_at: string;
};

type FeatureRequestVoteRow = {
  id: string;
  feature_request_id: string;
  user_id: string | null;
  anon_token_hash: string | null;
  created_at: string;
};

function normalizeStatus(value: string): FeatureRequestStatus {
  if (value === "planned" || value === "done" || value === "rejected") {
    return value;
  }
  return "new";
}

function normalizeMessage(value: string): string {
  const message = value.trim();
  if (!message) {
    throw new Error("Message is required.");
  }
  if (message.length > 4000) {
    throw new Error("Message must be 4000 characters or fewer.");
  }
  return message;
}

function normalizeSourcePage(value: string | null | undefined): string | null {
  const sourcePage = value?.trim();
  if (!sourcePage) return null;
  return sourcePage.slice(0, 255);
}

function toFeatureRequest(row: FeatureRequestRow, votes: number, comments: number): FeatureRequest {
  return {
    id: row.id,
    userId: row.user_id,
    message: row.message,
    status: normalizeStatus(row.status),
    sourcePage: row.source_page,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    votes,
    comments
  };
}

function toFeatureRequestComment(row: FeatureRequestCommentRow): FeatureRequestComment {
  return {
    id: row.id,
    featureRequestId: row.feature_request_id,
    userId: row.user_id,
    message: row.message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function mapCountsByRequestId(featureRequestIds: string[]): Promise<{
  votesByRequestId: Map<string, number>;
  commentsByRequestId: Map<string, number>;
}> {
  if (featureRequestIds.length === 0) {
    return {
      votesByRequestId: new Map(),
      commentsByRequestId: new Map()
    };
  }

  const votesByRequestId = new Map<string, number>();
  const commentsByRequestId = new Map<string, number>();

  await Promise.all(
    featureRequestIds.map(async (featureRequestId) => {
      const [votes, comments] = await Promise.all([
        supabaseRequest<FeatureRequestVoteRow[]>("feature_request_votes", {
          query: {
            feature_request_id: eq(featureRequestId),
            select: "id,feature_request_id,user_id,anon_token_hash,created_at"
          }
        }),
        supabaseRequest<FeatureRequestCommentRow[]>("feature_request_comments", {
          query: {
            feature_request_id: eq(featureRequestId),
            select: "id,feature_request_id,user_id,message,created_at,updated_at"
          }
        })
      ]);

      votesByRequestId.set(featureRequestId, votes.length);
      commentsByRequestId.set(featureRequestId, comments.length);
    })
  );

  return { votesByRequestId, commentsByRequestId };
}

export async function listFeatureRequests(input: {
  limit?: number;
  offset?: number;
  status?: FeatureRequestListFilter;
} = {}): Promise<FeatureRequest[]> {
  const clampedLimit = Number.isInteger(input.limit) ? Math.min(Math.max(input.limit ?? 50, 1), 200) : 50;
  const clampedOffset = Number.isInteger(input.offset) ? Math.max(input.offset ?? 0, 0) : 0;
  const status = input.status ?? "all";
  const query: Record<string, string> = {
    select: "id,user_id,message,status,source_page,created_at,updated_at",
    order: "created_at.desc",
    limit: String(clampedLimit),
    offset: String(clampedOffset)
  };
  if (status !== "all") {
    query.status = eq(status);
  }

  const rows = await supabaseRequest<FeatureRequestRow[]>("feature_requests", {
    query
  });

  const featureRequestIds = rows.map((row) => row.id);
  const { votesByRequestId, commentsByRequestId } = await mapCountsByRequestId(featureRequestIds);

  return rows.map((row) =>
    toFeatureRequest(row, votesByRequestId.get(row.id) ?? 0, commentsByRequestId.get(row.id) ?? 0)
  );
}

export async function getFeatureRequestById(id: string): Promise<FeatureRequest | null> {
  const rows = await supabaseRequest<FeatureRequestRow[]>("feature_requests", {
    query: {
      id: eq(id),
      select: "id,user_id,message,status,source_page,created_at,updated_at",
      limit: "1"
    }
  });

  const row = rows[0];
  if (!row) {
    return null;
  }

  const { votesByRequestId, commentsByRequestId } = await mapCountsByRequestId([id]);
  return toFeatureRequest(row, votesByRequestId.get(id) ?? 0, commentsByRequestId.get(id) ?? 0);
}

export async function createFeatureRequest(input: {
  userId?: string | null;
  message: string;
  sourcePage?: string | null;
}): Promise<FeatureRequest> {
  const now = new Date().toISOString();
  const id = `frq_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const rows = await supabaseRequest<FeatureRequestRow[]>("feature_requests", {
    method: "POST",
    body: [
      {
        id,
        user_id: input.userId ?? null,
        message: normalizeMessage(input.message),
        status: "new",
        source_page: normalizeSourcePage(input.sourcePage),
        created_at: now,
        updated_at: now
      }
    ]
  });

  return toFeatureRequest(rows[0], 0, 0);
}

export async function listFeatureRequestComments(featureRequestId: string): Promise<FeatureRequestComment[]> {
  const rows = await supabaseRequest<FeatureRequestCommentRow[]>("feature_request_comments", {
    query: {
      feature_request_id: eq(featureRequestId),
      select: "id,feature_request_id,user_id,message,created_at,updated_at",
      order: "created_at.asc"
    }
  });
  return rows.map(toFeatureRequestComment);
}

export async function addFeatureRequestComment(input: {
  featureRequestId: string;
  userId?: string | null;
  message: string;
}): Promise<FeatureRequestComment> {
  const now = new Date().toISOString();
  const rows = await supabaseRequest<FeatureRequestCommentRow[]>("feature_request_comments", {
    method: "POST",
    body: [
      {
        id: `frc_${randomUUID().replace(/-/g, "").slice(0, 14)}`,
        feature_request_id: input.featureRequestId,
        user_id: input.userId ?? null,
        message: normalizeMessage(input.message),
        created_at: now,
        updated_at: now
      }
    ]
  });

  await supabaseRequest<FeatureRequestRow[]>("feature_requests", {
    method: "PATCH",
    query: {
      id: eq(input.featureRequestId),
      select: "id,user_id,message,status,source_page,created_at,updated_at"
    },
    body: {
      updated_at: now
    }
  });

  return toFeatureRequestComment(rows[0]);
}

function normalizeAnonToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error("Anonymous vote token is required.");
  }
  return createHash("sha256").update(trimmed).digest("hex");
}

export async function addFeatureRequestVote(input: {
  featureRequestId: string;
  userId?: string | null;
  anonToken?: string | null;
}): Promise<{ created: boolean }> {
  const now = new Date().toISOString();
  const voteBody: Record<string, unknown> = {
    id: `frv_${randomUUID().replace(/-/g, "").slice(0, 14)}`,
    feature_request_id: input.featureRequestId,
    created_at: now
  };

  if (input.userId) {
    voteBody.user_id = input.userId;
  } else {
    voteBody.anon_token_hash = normalizeAnonToken(input.anonToken ?? "");
  }

  try {
    await supabaseRequest<FeatureRequestVoteRow[]>("feature_request_votes", {
      method: "POST",
      body: [voteBody]
    });
    return { created: true };
  } catch (error) {
    if (error instanceof SupabaseRequestError && error.status === 409) {
      return { created: false };
    }
    throw error;
  }
}

export async function removeFeatureRequestVote(input: {
  featureRequestId: string;
  userId?: string | null;
  anonToken?: string | null;
}): Promise<void> {
  if (!input.userId && !input.anonToken) {
    return;
  }

  const query: Record<string, string> = {
    feature_request_id: eq(input.featureRequestId)
  };
  if (input.userId) {
    query.user_id = eq(input.userId);
  } else {
    query.anon_token_hash = eq(normalizeAnonToken(input.anonToken ?? ""));
  }

  await supabaseRequest<unknown>("feature_request_votes", {
    method: "DELETE",
    query,
    prefer: "return=minimal"
  });
}

export async function updateFeatureRequestStatus(input: {
  id: string;
  status: FeatureRequestStatus;
}): Promise<FeatureRequest> {
  const now = new Date().toISOString();
  await supabaseRequest<FeatureRequestRow[]>("feature_requests", {
    method: "PATCH",
    query: {
      id: eq(input.id),
      select: "id,user_id,message,status,source_page,created_at,updated_at"
    },
    body: {
      status: input.status,
      updated_at: now
    }
  });

  const updated = await getFeatureRequestById(input.id);
  if (!updated) {
    throw new Error("Feature request not found.");
  }
  return updated;
}

export function createAnonymousVoteToken(): string {
  return randomUUID().replace(/-/g, "");
}
