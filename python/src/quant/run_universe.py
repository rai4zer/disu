from __future__ import annotations

import argparse
import os
from datetime import datetime
import pandas as pd

from src.quant.predict import infer_one


def read_tickers(path: str) -> list[str]:
    with open(path, "r", encoding="utf-8") as f:
        return [
            line.strip().upper()
            for line in f
            if line.strip() and not line.strip().startswith("#")
        ]


def zscore(s: pd.Series) -> pd.Series:
    s = s.astype(float)
    sd = s.std(ddof=0)
    if sd == 0 or pd.isna(sd):
        return s * 0.0
    return (s - s.mean()) / sd


def run_universe(tickers: list[str], retrain: bool = False) -> pd.DataFrame:
    frames = []
    errors = []

    for t in tickers:
        try:
            frames.append(infer_one(t, retrain=retrain))
        except Exception as e:
            errors.append({"ticker": t, "error": str(e)})

    if errors:
        os.makedirs("logs", exist_ok=True)
        pd.DataFrame(errors).to_csv("logs/universe_errors.csv", index=False)

    if not frames:
        raise RuntimeError("No successful tickers. See logs/universe_errors.csv")

    signals = pd.concat(frames, ignore_index=True)

    # Cross-sectional ranking per (date, horizon)
    # Minimal composite score: z(pred_return) + 0.5*z(p_up)
    signals["score"] = signals.groupby(["date", "horizon"], group_keys=False).apply(
        lambda g: zscore(g["pred_return"]) + 0.5 * zscore(g["p_up"])
    )
    signals["rank_score"] = signals.groupby(["date", "horizon"])["score"].rank(
        ascending=False, method="first"
    )
    signals["rank_ret"] = signals.groupby(["date", "horizon"])["pred_return"].rank(
        ascending=False, method="first"
    )
    signals["rank_p_up"] = signals.groupby(["date", "horizon"])["p_up"].rank(
        ascending=False, method="first"
    )

    signals["run_ts"] = datetime.now().isoformat(timespec="seconds")
    return signals


def main():
    p = argparse.ArgumentParser(description="Universe runner (cross-sectional inference)")
    p.add_argument("--tickers", type=str, default="tickers.txt", help="Path to tickers file")
    p.add_argument("--retrain", action="store_true", help="Retrain models (slow)")
    p.add_argument("--out", type=str, default=None, help="Output path (.parquet or .csv)")
    args = p.parse_args()

    tickers = read_tickers(args.tickers)
    df = run_universe(tickers, retrain=args.retrain)

    os.makedirs("signals", exist_ok=True)

    if args.out is None:
        d = sorted(df["date"].unique())[-1]
        args.out = f"signals/{d}_signals.parquet"

    if args.out.endswith(".csv"):
        df.to_csv(args.out, index=False)
    else:
        df.to_parquet(args.out, index=False)

    print(f"Wrote: {args.out}")
    print(df.sort_values(["date", "horizon", "rank_score"]).head(25).to_string(index=False))


if __name__ == "__main__":
    main()
