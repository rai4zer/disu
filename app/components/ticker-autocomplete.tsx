"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildTickerSuggestions, type ResolvedSuggestion } from "@/app/lib/ticker-suggestions";
import styles from "./ticker-autocomplete.module.css";

type ApiSuggestion = {
  symbol: string;
  name: string;
  label: string;
  currency?: string;
};

type Props = {
  id: string;
  value: string;
  onChange: (next: string) => void;
  onPickSymbol?: (symbol: string) => void;
  onPickSuggestion?: (suggestion: ApiSuggestion) => void;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  className?: string;
};

function mergeSuggestions(local: ResolvedSuggestion[], remote: ApiSuggestion[]): ApiSuggestion[] {
  return [...remote, ...local.map((item) => ({ symbol: item.symbol, name: item.name, label: item.label }))].filter(
    (item, idx, arr) => arr.findIndex((x) => x.symbol === item.symbol) === idx
  );
}

export default function TickerAutocomplete({
  id,
  value,
  onChange,
  onPickSymbol,
  onPickSuggestion,
  placeholder,
  required,
  maxLength,
  className
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [remoteSuggestions, setRemoteSuggestions] = useState<ApiSuggestion[]>([]);
  const [menuPlacement, setMenuPlacement] = useState<"up" | "down">("down");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const localSuggestions = useMemo(() => buildTickerSuggestions(value, 8), [value]);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 2) {
      setRemoteSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/tickers/search?q=${encodeURIComponent(query)}&limit=12`, {
          signal: controller.signal
        });
        const payload = (await response.json()) as { ok: boolean; suggestions?: ApiSuggestion[] };
        if (!payload.ok) {
          setRemoteSuggestions([]);
          return;
        }
        setRemoteSuggestions(Array.isArray(payload.suggestions) ? payload.suggestions : []);
      } catch {
        setRemoteSuggestions([]);
      }
    }, 130);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  const suggestions = useMemo(() => mergeSuggestions(localSuggestions, remoteSuggestions).slice(0, 12), [
    localSuggestions,
    remoteSuggestions
  ]);

  useEffect(() => {
    if (!open || !wrapRef.current) {
      return;
    }
    const updatePlacement = () => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setMenuPlacement(spaceBelow < 220 && spaceAbove > spaceBelow ? "up" : "down");
    };
    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [open]);

  function applySuggestion(item: ApiSuggestion) {
    onChange(item.symbol);
    onPickSymbol?.(item.symbol);
    onPickSuggestion?.(item);
    setOpen(false);
    setActiveIndex(-1);
  }

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <input
        ref={inputRef}
        id={id}
        className={className ? `${styles.input} ${className}` : styles.input}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120);
        }}
        aria-controls={`${id}-suggestions`}
        aria-activedescendant={activeIndex >= 0 ? `${id}-suggestion-${activeIndex}` : undefined}
        onKeyDown={(event) => {
          if (!open || suggestions.length === 0) {
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((idx) => Math.min(suggestions.length - 1, idx + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((idx) => Math.max(0, idx - 1));
          } else if (event.key === "Enter" && activeIndex >= 0) {
            event.preventDefault();
            applySuggestion(suggestions[activeIndex]);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            setActiveIndex(-1);
          }
        }}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        autoComplete="off"
      />

      {open && suggestions.length > 0 ? (
        <div
          id={`${id}-suggestions`}
          className={`${styles.menu} ${menuPlacement === "up" ? styles.menuUp : styles.menuDown}`}
          role="listbox"
          aria-label="Ticker suggestions"
        >
          {suggestions.map((item, idx) => (
            <button
              id={`${id}-suggestion-${idx}`}
              key={item.symbol}
              type="button"
              className={`${styles.item} ${idx === activeIndex ? styles.itemActive : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applySuggestion(item)}
              onMouseEnter={() => setActiveIndex(idx)}
            >
              <span className={styles.symbol}>{item.symbol}</span>
              <span className={styles.name}>{item.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
