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


def main() -> None:
    parser = argparse.ArgumentParser(description="JSON bridge for quant inference")
    parser.add_argument("--ticker", required=True, type=str)
    parser.add_argument("--retrain", action="store_true")
    args = parser.parse_args()

    ticker = args.ticker.strip().upper()

    try:
        result = infer_one(ticker=ticker, retrain=args.retrain)
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
