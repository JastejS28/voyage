"""
Swappable LLM configuration for Itinerary Agents.

Uses the **google-genai** SDK (`google.genai.Client`).

Quick-start:
    config = LLMConfig()
    client = config.get_client()       # google.genai.Client
    model  = config.model_name         # e.g. "gemini-2.0-flash"

Switch model:
    config = LLMConfig(model_name="gemini-2.5-flash-preview-05-20")

Bring-your-own client:
    config = LLMConfig(custom_client=my_genai_client)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from os import getenv
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from google import genai
from google.genai import types

# load_dotenv(dotenv_path=str(Path(__file__).resolve().parent.parent / "config.env"))
load_dotenv()


logger = logging.getLogger("LLMConfig")


@dataclass
class LLMConfig:
    """
    Centralised LLM configuration backed by Google GenAI.

    To swap models across every agent, change *model_name* once.
    """

    model_name: str = "gemini-2.5-flash"
    temperature: float = 0.2
    max_output_tokens: Optional[int] = 65536
    thinking_budget: Optional[int] = 0        # 0 = thinking disabled
    api_key: Optional[str] = None
    custom_client: Optional[Any] = None        # bypass config entirely
    extra_kwargs: dict[str, Any] = field(default_factory=dict)

    # ──────────────────────────────────────────────────────────────────────
    def get_client(self) -> genai.Client:
        """Build and return a ``google.genai.Client``."""
        if self.custom_client is not None:
            logger.info("Using custom (pre-built) GenAI client")
            return self.custom_client

        api_key = self.api_key or getenv("GEMINI_API_KEY", "")
        if not api_key:
            raise ValueError(
                "GEMINI_API_KEY not set. Pass api_key= or set the env var."
            )

        logger.info(
            "Creating GenAI client  model=%s  temperature=%s",
            self.model_name, self.temperature,
        )
        return genai.Client(api_key=api_key)

    def get_generation_config(self, **overrides: Any) -> types.GenerateContentConfig:
        """Return a ``GenerateContentConfig`` with the stored defaults."""
        kwargs: dict[str, Any] = {
            "temperature": self.temperature,
            **self.extra_kwargs,
            **overrides,
        }
        if self.max_output_tokens:
            kwargs["max_output_tokens"] = self.max_output_tokens
        # Cap thinking tokens so the model uses most of the budget for output
        if self.thinking_budget is not None:
            kwargs["thinking_config"] = types.ThinkingConfig(
                thinking_budget=self.thinking_budget,
            )
        return types.GenerateContentConfig(**kwargs)

    # convenience ----------------------------------------------------------
    def __repr__(self) -> str:
        return (
            f"LLMConfig(model={self.model_name!r}, "
            f"temperature={self.temperature})"
        )
