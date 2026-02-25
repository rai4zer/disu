import pandas as pd
import numpy as np

from src.quant.data import fetch_price_history

SIGNAL_DATE = pd.Timestamp("2026-02-02")
REALIZED_DATE = pd.Timestamp("2026-02-04")
SIGNALS_PATH = "signals/2026-02-02_signals.parquet"

# --- Load signals ---
signals = pd.read_parquet(SIGNALS_PATH)

# Restrict to horizon (adjust if needed)
df = signals.query("horizon == 1").copy()

tickers = df["ticker"].unique().tolist()

# --- Fetch prices per ticker and build a wide price matrix ---
series = []
for t in tickers:
    px = fetch_price_history(ticker=t, years=2)  # 2 years is enough to include 2026-02
    # Expect px has a DatetimeIndex and some price column (adj_close/close)
    px.index = pd.to_datetime(px.index)

    # pick best available column
    col = None
    for c in ["adj_close", "Adj Close", "adjclose", "close", "Close"]:
        if c in px.columns:
            col = c
            break
    if col is None:
        raise ValueError(f"{t}: couldn't find a price column in {list(px.columns)}")

    s = px[col].rename(t)
    series.append(s)

prices = pd.concat(series, axis=1).sort_index()

# --- Align to actual available trading days ---
# Get nearest on/after dates (robust to missing days)
signal_dt = prices.index[prices.index.get_indexer([SIGNAL_DATE], method="bfill")[0]]
realized_dt = prices.index[prices.index.get_indexer([REALIZED_DATE], method="bfill")[0]]

# Compute realized returns (close-to-close)
realized_returns = (prices.loc[realized_dt] / prices.loc[signal_dt] - 1).rename("realized_return")

df = df.merge(realized_returns, left_on="ticker", right_index=True, how="inner")

# --- Direction checks ---
df["predicted_up"] = df["p_up"] > 0.5
df["realized_up"] = df["realized_return"] > 0
direction_accuracy = (df["predicted_up"] == df["realized_up"]).mean()

# --- Magnitude checks ---
mae = np.mean(np.abs(df["pred_return"] - df["realized_return"]))
corr = df["pred_return"].corr(df["realized_return"])

# --- Rank IC (core metric for cross-sectional) ---
df["pred_rank"] = df["score"].rank(ascending=False)
df["realized_rank"] = df["realized_return"].rank(ascending=False)
rank_ic = df["pred_rank"].corr(df["realized_rank"], method="spearman")

print(f"Post-hoc validation ({signal_dt.date()} → {realized_dt.date()})")
print(f"Direction accuracy: {direction_accuracy:.2%}")
print(f"MAE: {mae:.4f}")
print(f"Return correlation: {corr:.4f}")
print(f"Rank IC (Spearman): {rank_ic:.4f}")

print("\nTop-ranked examples:")
print(
    df.sort_values("score", ascending=False)
      .head(10)[["ticker", "pred_return", "realized_return", "p_up"]]
)
