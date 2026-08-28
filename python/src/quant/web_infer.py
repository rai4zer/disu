from __future__ import annotations

import argparse
import json
import traceback
from typing import Any

import pandas as pd

from src.quant.predict import infer_one


def _json_default(value: Any):
    if isinstance(value, (pd.Timestamp,)):
        return value.isoformat()
    raise TypeError(f"Type not serializable: {type(value)}")


def _require_columns(frame: pd.DataFrame, required: list[str], name: str) -> None:
    missing = [col for col in required if col not in frame.columns]
    if missing:
        raise ValueError(f"{name} missing required columns: {', '.join(missing)}")


def _validate_infer_result(result: dict[str, Any], ticker: str) -> None:
    rows = result.get("rows")
    history = result.get("history")
    if not isinstance(rows, pd.DataFrame):
        raise ValueError("rows must be a pandas DataFrame")
    if not isinstance(history, pd.DataFrame):
        raise ValueError("history must be a pandas DataFrame")

    _require_columns(
        rows,
        ["date", "ticker", "horizon", "adj_close", "pred_return", "p_up_raw", "p_up", "implied_price", "model_path"],
        "rows",
    )
    _require_columns(
        history,
        ["date", "open", "high", "low", "close", "adj_close", "dividends"],
        "history",
    )

    if rows.empty:
        raise ValueError("rows must not be empty")
    if history.empty:
        raise ValueError("history must not be empty")

    row_tickers = rows["ticker"].astype(str).str.upper().unique().tolist()
    if ticker.upper() not in row_tickers:
        raise ValueError("rows ticker values do not match requested ticker")


def main() -> None:
    parser = argparse.ArgumentParser(description="JSON bridge for quant inference")
    parser.add_argument("--ticker", required=True, type=str)
    parser.add_argument("--retrain", action="store_true")
    args = parser.parse_args()

    ticker = args.ticker.strip().upper()

    try:
        result = infer_one(ticker=ticker, retrain=args.retrain)
        _validate_infer_result(result, ticker)
        payload = {
            "ok": True,
            "ticker": ticker,
            "rows": result["rows"].to_dict(orient="records"),
            "history": result["history"].to_dict(orient="records"),
        }
        print(json.dumps(payload, default=_json_default))
    except Exception as error:
        payload = {
            "ok": False,
            "error": str(error),
            "traceback": traceback.format_exc(limit=8),
        }
        print(json.dumps(payload))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
