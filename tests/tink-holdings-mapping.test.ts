import assert from "node:assert/strict";
import test from "node:test";
import { mapTinkHoldingsPayloadForTests } from "../app/lib/brokers/tink.ts";

test("maps holdings payload with nested numeric fields", () => {
  const rows = mapTinkHoldingsPayloadForTests({
    holdings: [
      {
        instrument: {
          ticker: "AAPL",
          isin: "US0378331005",
          name: "Apple Inc"
        },
        quantity: { value: "12.5" },
        average_cost: "155.4",
        market_value: { amount: "2024.13", currency_code: "USD" },
        updated_at: "2026-03-05T09:00:00.000Z"
      }
    ]
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "AAPL");
  assert.equal(rows[0].isin, "US0378331005");
  assert.equal(rows[0].name, "Apple Inc");
  assert.equal(rows[0].quantity, 12.5);
  assert.equal(rows[0].avgCost, 155.4);
  assert.equal(rows[0].marketValue, 2024.13);
  assert.equal(rows[0].currency, "USD");
});

test("falls back to isin as symbol and filters malformed rows", () => {
  const rows = mapTinkHoldingsPayloadForTests({
    positions: [
      {
        isin: "SE0000108656",
        instrumentName: "Ericsson B",
        shares: 20,
        value: 1800
      },
      {
        quantity: 1
      }
    ]
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "SE0000108656");
  assert.equal(rows[0].name, "Ericsson B");
  assert.equal(rows[0].quantity, 20);
  assert.equal(rows[0].marketValue, 1800);
  assert.equal(rows[0].currency, "SEK");
});

test("maps holdings with identifiers and scaled numeric payloads", () => {
  const rows = mapTinkHoldingsPayloadForTests({
    holdings: [
      {
        instrument: {
          id: "inst_123",
          name: "Sandbox Instrument",
          identifiers: [
            { type: "ISIN", value: "SE0000000010" },
            { type: "TICKER", value: "SBOX" }
          ]
        },
        quantity: {
          unscaledValue: 12345,
          scale: 2
        },
        market_value: {
          value: {
            unscaledValue: 987654,
            scale: 2
          },
          currency_code: "SEK"
        }
      }
    ]
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "SBOX");
  assert.equal(rows[0].isin, "SE0000000010");
  assert.equal(rows[0].name, "Sandbox Instrument");
  assert.equal(rows[0].quantity, 123.45);
  assert.equal(rows[0].marketValue, 9876.54);
  assert.equal(rows[0].currency, "SEK");
});

test("maps Tink holdings payload with financialInstrument and holdingValue fields", () => {
  const rows = mapTinkHoldingsPayloadForTests({
    holdings: [
      {
        financialInstrument: {
          id: "instrument-001",
          name: "Investor AB",
          identifiers: [
            { type: "ISIN", value: "SE0015811963" },
            { type: "TICKER", value: "INVE-B" }
          ]
        },
        quantity: {
          value: 42
        },
        holdingValue: {
          value: 9876.5,
          currencyCode: "SEK"
        },
        accountId: "acct_123"
      }
    ]
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "INVE-B");
  assert.equal(rows[0].isin, "SE0015811963");
  assert.equal(rows[0].name, "Investor AB");
  assert.equal(rows[0].quantity, 42);
  assert.equal(rows[0].marketValue, 9876.5);
  assert.equal(rows[0].currency, "SEK");
});
