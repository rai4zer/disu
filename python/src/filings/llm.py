import os
import time
import random
import requests
from typing import Optional


class LLMClient:
    def summarize(self, system: str, prompt: str, max_tokens: Optional[int] = None) -> str:
        raise NotImplementedError


class NoneLLM(LLMClient):
    def summarize(self, system: str, prompt: str, max_tokens: Optional[int] = None) -> str:
        return "[LLM disabled]"


class OpenAICompatibleLLM(LLMClient):
    """
    Works with Groq and other OpenAI-compatible endpoints.
    Adds retry/backoff for 429 and transient errors.
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        timeout_sec: int = 120,
        min_interval_sec: float = 1.2,
        max_retries: int = 8,
        max_prompt_chars: int = 120_000,
        default_max_tokens: int = 900,
        max_input_tokens: int = 6_000,
        max_output_tokens: int = 1_200,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout_sec = int(timeout_sec)
        self.min_interval_sec = float(min_interval_sec)
        self.max_retries = int(max_retries)
        self.max_prompt_chars = int(max_prompt_chars)
        self.default_max_tokens = int(default_max_tokens)
        self.max_input_tokens = int(max_input_tokens)
        self.max_output_tokens = int(max_output_tokens)
        self._last_call_ts = 0.0

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        # Lightweight approximation for rate-guard purposes.
        return max(1, (len(text) + 3) // 4)

    def _truncate_for_token_cap(self, system: str, prompt: str) -> str:
        if self.max_input_tokens <= 0:
            return prompt

        system_tokens = self._estimate_tokens(system or "")
        allowed_prompt_tokens = self.max_input_tokens - system_tokens
        if allowed_prompt_tokens <= 32:
            return prompt[:256]

        if self._estimate_tokens(prompt) <= allowed_prompt_tokens:
            return prompt

        approx_chars = allowed_prompt_tokens * 4
        suffix = "\n\n[TRUNCATED: prompt exceeded max_input_tokens]"
        trimmed = prompt[: max(0, approx_chars - len(suffix))]
        return f"{trimmed}{suffix}"

    def _sleep_spacing(self) -> None:
        dt = time.time() - self._last_call_ts
        if dt < self.min_interval_sec:
            time.sleep(self.min_interval_sec - dt)

    def _print_error(self, r: requests.Response) -> None:
        try:
            txt = r.text
        except Exception:
            txt = "<no body>"
        print(f"[LLM ERROR] status={r.status_code} url={r.url}")
        print(txt[:2000])

    def summarize(self, system: str, prompt: str, max_tokens: Optional[int] = None) -> str:
        url = f"{self.base_url}/chat/completions"

        prompt = self._truncate_for_token_cap(system, prompt or "")

        if prompt and len(prompt) > self.max_prompt_chars:
            prompt = (
                prompt[: self.max_prompt_chars]
                + "\n\n[TRUNCATED: prompt exceeded max_prompt_chars]"
            )

        requested_output_tokens = int(max_tokens or self.default_max_tokens)
        if self.max_output_tokens > 0:
            requested_output_tokens = min(requested_output_tokens, self.max_output_tokens)

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.2,
            "max_tokens": requested_output_tokens,
        }

        for attempt in range(self.max_retries + 1):
            self._sleep_spacing()

            try:
                r = requests.post(
                    url,
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    timeout=self.timeout_sec,
                )
                self._last_call_ts = time.time()

                if r.status_code == 429:
                    self._print_error(r)
                    time.sleep(min(60.0, (2 ** attempt) + random.random()))
                    continue

                if r.status_code in (500, 502, 503, 504):
                    self._print_error(r)
                    time.sleep(min(30.0, (2 ** attempt) * 0.5 + random.random()))
                    continue

                if r.status_code >= 400:
                    self._print_error(r)
                    r.raise_for_status()

                data = r.json()
                return (data["choices"][0]["message"]["content"] or "").strip()

            except requests.RequestException:
                if attempt >= self.max_retries:
                    raise
                time.sleep(min(30.0, (2 ** attempt) * 0.5 + random.random()))

        raise RuntimeError("LLM call failed after retries.")


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def build_llm(provider: str, host: str, model: str) -> LLMClient:
    provider = (provider or "").lower().strip()

    if provider == "openai_compatible":
        api_key = os.environ.get("GROQ_API_KEY") or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("Missing GROQ_API_KEY (or OPENAI_API_KEY).")
        if not host:
            raise RuntimeError("Missing base_url for openai_compatible.")
        if not model:
            raise RuntimeError("Missing model name.")

        return OpenAICompatibleLLM(
            base_url=host,
            api_key=api_key,
            model=model,
            min_interval_sec=1.2,   # ✅ FIXED (was 30s)
            default_max_tokens=900, # sane default for primers
            max_input_tokens=_env_int("GROQ_MAX_INPUT_TOKENS", 6000),
            max_output_tokens=_env_int("GROQ_MAX_OUTPUT_TOKENS", 1200),
        )

    return NoneLLM()
