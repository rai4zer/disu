export type PlaceraComment = {
  id: string;
  content: string;
  created: string | null;
  author_name: string | null;
};

export type PlaceraPost = {
  id: string;
  content: string;
  reply_count: number;
  created: string | null;
  client_url?: string | null;
  comments: PlaceraComment[];
};

export type PlaceraEntity = {
  id: string;
  entity_type: "post" | "reply";
  parent_post_id: string;
  content: string;
  created: string | null;
  author_name: string | null;
  sentiment_score: number;
  sentiment_bucket: "positive" | "neutral" | "negative";
};

export type SentimentSummary = {
  score: number;
  label: "positive" | "neutral" | "negative";
  band: "very_bearish" | "bearish" | "neutral" | "bullish" | "very_bullish";
  confidence: {
    score: number;
    level: "low" | "medium" | "high";
  };
  distribution: {
    positive: { count: number; percent: number };
    neutral: { count: number; percent: number };
    negative: { count: number; percent: number };
  };
  badge: "armageddon" | "strong_bear" | "bear" | "neutral" | "bull" | "strong_bull" | "exuberance";
  total_entities: number;
};

export type PlaceraPayload = {
  companyId: string;
  companyQuery?: string;
  lookback_days: number;
  window_start: string;
  window_end: string;
  posts: PlaceraPost[];
  entities: PlaceraEntity[];
  sentiment: SentimentSummary;
};
