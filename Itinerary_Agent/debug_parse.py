"""Debug script to understand why LLM JSON parsing fails."""
import re
import json
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

# Test 1: Fence stripping regex
sample = '```json\n{"plan_type": "core", "summary": "test"}\n```'
print("=== TEST 1: Regex fence stripping ===")
print("INPUT:", repr(sample))

cleaned = sample.strip()
cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
cleaned = re.sub(r"\s*```\s*$", "", cleaned)
cleaned = cleaned.strip()
print("CLEANED:", repr(cleaned))
try:
    print("PARSED:", json.loads(cleaned))
except Exception as e:
    print("PARSE ERROR:", e)

# Test 2: Brace-counting parser
print("\n=== TEST 2: Brace-counting parser ===")
text_with_preamble = 'Here is the JSON:\n```json\n{"plan_type": "core", "summary": "test"}\n```\nDone!'
print("INPUT:", repr(text_with_preamble))

start_idx = text_with_preamble.find("{")
if start_idx != -1:
    depth = 0
    in_string = False
    escape_next = False
    for i in range(start_idx, len(text_with_preamble)):
        ch = text_with_preamble[i]
        if escape_next:
            escape_next = False
            continue
        if ch == "\\":
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                candidate = text_with_preamble[start_idx : i + 1]
                print("CANDIDATE:", repr(candidate))
                print("PARSED:", json.loads(candidate))
                break

# Test 3: Real LLM call
print("\n=== TEST 3: Real GenAI call ===")
from llm_config import LLMConfig

cfg = LLMConfig()
client = cfg.get_client()
resp = client.models.generate_content(
    model=cfg.model_name,
    contents='Return a JSON object with keys: plan_type (string), summary (string). Keep it short. Return ONLY the JSON, no markdown fences.',
    config=cfg.get_generation_config(
        system_instruction="You are an assistant that returns valid JSON only. No markdown, no code fences, just raw JSON."
    ),
)

text = resp.text
print("RESPONSE TYPE:", type(text))
print("RESPONSE LEN:", len(text))
print("STARTS WITH:", repr(text[:200]))
print("ENDS WITH:", repr(text[-200:]))
print("FULL TEXT:")
print(text)

# Try parsing the real response
print("\n=== TEST 4: Parse real response ===")
cleaned = text.strip()
cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
cleaned = re.sub(r"\s*```\s*$", "", cleaned)
cleaned = cleaned.strip()
print("CLEANED:", repr(cleaned[:200]))

try:
    parsed = json.loads(cleaned)
    print("SUCCESS:", parsed)
except json.JSONDecodeError as e:
    print("PARSE ERROR:", e)
    # try brace counting
    start_idx = cleaned.find("{")
    if start_idx != -1:
        depth = 0
        in_string = False
        escape_next = False
        for i in range(start_idx, len(cleaned)):
            ch = cleaned[i]
            if escape_next:
                escape_next = False
                continue
            if ch == "\\":
                escape_next = True
                continue
            if ch == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    candidate = cleaned[start_idx : i + 1]
                    try:
                        parsed = json.loads(candidate)
                        print("BRACE-COUNT SUCCESS:", parsed)
                    except json.JSONDecodeError as e2:
                        print("BRACE-COUNT FAIL:", e2)
                    break

# Test 5: Check response parts for thinking
print("\n=== TEST 5: Response parts ===")
for i, candidate in enumerate(resp.candidates):
    print(f"Candidate {i}:")
    for j, part in enumerate(candidate.content.parts):
        thought = getattr(part, "thought", None)
        print(f"  Part {j}: thought={thought}, text_len={len(part.text) if part.text else 0}, text_start={repr(part.text[:100]) if part.text else None}")
