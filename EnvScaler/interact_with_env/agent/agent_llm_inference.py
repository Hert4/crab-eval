"""
LLM inference utilities for action agent inference.
"""

import os
import json
import time
from openai import OpenAI
from dotenv import load_dotenv
from typing import List, Dict, Any, Tuple, Optional

# Load environment variables
load_dotenv()


def openai_inference_prompt(
    model: str, 
    messages: List[Dict[str, Any]], 
    temperature: float = None,
    enable_thinking: bool = False,
    api_key: str = None,
    base_url: str = None
    ) -> str:
    """Non-streaming inference for prompt mode."""
    client = OpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"), base_url=base_url or os.getenv("OPENAI_BASE_URL"))
    retries = 0
    max_retries = 10
    while retries < max_retries:
        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                stream=False,
                temperature=temperature,
                max_tokens=10000,
                n=1,
                **({"extra_body": {"chat_template_kwargs": {"enable_thinking": enable_thinking}}} if enable_thinking else {}),
            )
            content = response.choices[0].message.content
            # Get reasoning content if available
            if hasattr(response.choices[0].message, "reasoning_content"):
                reasoning_content = response.choices[0].message.reasoning_content
            else:
                reasoning_content = ""
            # Prepend reasoning content if not empty (Qwen3 template style)
            if reasoning_content:
                reasoning_content = reasoning_content.strip()
                content = f"<think>\n{reasoning_content}\n</think>\n\n{content}"
            return content

        except Exception as e:
            print(f"Something wrong: {e}. Retrying in {retries * 10 + 10} seconds...")
            time.sleep(2)
            
            retries += 1
            
    print(f"Failed to get response after {max_retries} retries.")
    return ''

def openai_stream_inference_prompt(
    model: str,
    messages: List[Dict[str, Any]],
    temperature: float = None,
    enable_thinking: bool = False,
    api_key: str = None,
    base_url: str = None
) -> str:
    """Streaming inference for prompt mode."""
    client = OpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"), base_url=base_url or os.getenv("OPENAI_BASE_URL"))

    retries = 0
    max_retries = 10
    max_tokens = 10000
    while retries < max_retries:
        params = {
            "model": model,
            "messages": messages,
            "stream": True,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "n": 1
        }
        if enable_thinking:
            params["extra_body"] = {"chat_template_kwargs": {"enable_thinking": enable_thinking}}
        try:
            completion = client.chat.completions.create(**params)

            reasoning_content = ""
            content = ""

            for chunk in completion:
                if not getattr(chunk, "choices", None):
                    continue

                choice = chunk.choices[0]
                delta = choice.delta

                # Accumulate reasoning content
                if hasattr(delta, "reasoning_content") and delta.reasoning_content:
                    reasoning_content += delta.reasoning_content

                # Accumulate content
                if hasattr(delta, "content") and delta.content:
                    content += delta.content

            reasoning_content = reasoning_content.strip()
            content = content.strip()

            # Check if <think> tag is present in content
            if not reasoning_content and content and '</think>' in content:
                reasoning_content = content.split('</think>')[0].strip()
                if '<think>' in reasoning_content:
                    reasoning_content = reasoning_content.split('<think>')[1].strip()
                content = content.split('</think>')[1].strip()
            
            # Prepend reasoning content if not empty (Qwen3 template style)
            if reasoning_content:
                content = f"<think>\n{reasoning_content}\n</think>\n\n{content}"

            if content == "":
                raise ValueError("content is empty.")
            return content
        
        except Exception as e:
            print(f"Something wrong: {e}. Retrying in {retries * 10 + 10} seconds...")
            time.sleep(2)
            if retries >= 5:
                max_tokens = 5000
                print(f"max_tokens: {max_tokens}")
            retries += 1

    print(f"Failed to get response after {max_retries} retries.")
    return ""

def _chat_messages_to_responses_input(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Convert Chat Completions message history → Responses API input format.

    Chat Completions: tool_calls attached to assistant message, tool result as role=tool.
    Responses API: separate items
        {"type": "function_call",        "call_id": ..., "name": ..., "arguments": ...}
        {"type": "function_call_output", "call_id": ..., "output": ...}
    Plain role messages keep their {role, content} shape.
    """
    out: List[Dict[str, Any]] = []
    for msg in messages:
        role = msg.get("role")
        if role == "tool":
            out.append({
                "type": "function_call_output",
                "call_id": msg.get("tool_call_id", ""),
                "output": msg.get("content", "") if isinstance(msg.get("content"), str)
                         else json.dumps(msg.get("content"), ensure_ascii=False),
            })
            continue
        if role == "assistant" and msg.get("tool_calls"):
            # Emit content first (if any), then each tool call as its own item.
            content = msg.get("content") or ""
            if content:
                out.append({"role": "assistant", "content": content})
            for tc in msg["tool_calls"]:
                fn = tc.get("function", {}) if isinstance(tc, dict) else {}
                out.append({
                    "type": "function_call",
                    "call_id": tc.get("id", "") if isinstance(tc, dict) else "",
                    "name": fn.get("name", ""),
                    "arguments": fn.get("arguments", "") if isinstance(fn.get("arguments"), str)
                                else json.dumps(fn.get("arguments", {}), ensure_ascii=False),
                })
            continue
        # Plain message — pass through with whitelisted keys.
        clean = {k: v for k, v in msg.items() if k in ("role", "content")}
        if clean:
            out.append(clean)
    return out


def _openai_responses_api_fc(
    client: OpenAI,
    model: str,
    messages: List[Dict[str, Any]],
    tools: Optional[List[Dict]] = None,
) -> Dict[str, Any]:
    """Use OpenAI Responses API for gpt-5.x models that don't support Chat Completions streaming."""
    kwargs: Dict[str, Any] = {"model": model, "input": _chat_messages_to_responses_input(messages)}
    if tools:
        # Responses API wants FLAT tool definitions:
        #   {"type": "function", "name": ..., "description": ..., "parameters": ...}
        # Chat Completions format is nested under "function": flatten if needed.
        flat = []
        for t in tools:
            if "function" in t and isinstance(t["function"], dict):
                fn = t["function"]
                flat.append({
                    "type": "function",
                    "name": fn.get("name", ""),
                    "description": fn.get("description", ""),
                    "parameters": fn.get("parameters", {}),
                })
            elif "name" in t:
                flat.append({"type": "function", **t} if t.get("type") != "function" else t)
        kwargs["tools"] = flat
    response = client.responses.create(**kwargs)

    content = getattr(response, "output_text", "") or ""
    tool_calls = []
    # Extract function tool calls from response.output
    for item in getattr(response, "output", []):
        if getattr(item, "type", "") == "function_call":
            tool_calls.append({
                "id": getattr(item, "call_id", "") or "",
                "type": "function",
                "function": {
                    "name": getattr(item, "name", ""),
                    "arguments": getattr(item, "arguments", ""),
                }
            })
    return {"reasoning_content": "", "tool_calls": tool_calls, "content": content}


def openai_stream_inference_fc(
    model: str,
    messages: List[Dict[str, Any]],
    temperature: float = None,
    tools: Optional[List[Dict]] = None,
    enable_thinking: bool = False,
    api_key: str = None,
    base_url: str = None
) -> Dict[str, Any]:
    """
    Streaming inference using official Model tool interface (function calling mode).
    Returns:
        {
            "reasoning_content": str,
            "tool_calls": list,
            "content": str
        }
    """
    client = OpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"), base_url=base_url or os.getenv("OPENAI_BASE_URL"))

    retries = 0
    max_retries = 10
    while retries < max_retries:
        try:
            # gpt-5.x models use the Responses API (not Chat Completions)
            if 'gpt-5' in model:
                return _openai_responses_api_fc(client, model, messages, tools)

            if tools:
                completion = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    stream=True,
                    temperature=temperature,
                    max_tokens=10000,
                    tools=tools,
                    tool_choice="auto",
                    top_p=0.95,
                    n=1,
                    **({"extra_body": {"chat_template_kwargs": {"enable_thinking": enable_thinking}}} if enable_thinking else {})
                )
            else:
                completion = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    stream=True,
                    temperature=temperature,
                    max_tokens=10000,
                    n=1,
                    **({"extra_body": {"chat_template_kwargs": {"enable_thinking": enable_thinking}}} if enable_thinking else {})
                )

            reasoning_content = ""
            content = ""
            # Accumulate tool calls by index
            tool_calls_accum: Dict[int, Dict[str, Any]] = {}

            for chunk in completion:
                if not getattr(chunk, "choices", None):
                    continue

                choice = chunk.choices[0]
                delta = choice.delta

                # Accumulate reasoning content
                if hasattr(delta, "reasoning_content") and delta.reasoning_content:
                    reasoning_content += delta.reasoning_content

                # Accumulate content
                if hasattr(delta, "content") and delta.content:
                    content += delta.content

                # Accumulate tool call information
                if hasattr(delta, "tool_calls") and delta.tool_calls:
                    for tool_call in delta.tool_calls:
                        idx = tool_call.index
                        if idx not in tool_calls_accum:
                            tool_calls_accum[idx] = {
                                "id": tool_call.id or "",
                                "type": tool_call.type or "function",
                                "function": {
                                    "name": "",
                                    "arguments": ""
                                }
                            }
                        if tool_call.id:
                            tool_calls_accum[idx]["id"] = tool_call.id
                        if tool_call.type:
                            tool_calls_accum[idx]["type"] = tool_call.type
                        if tool_call.function:
                            if tool_call.function.name:
                                tool_calls_accum[idx]["function"]["name"] += tool_call.function.name
                            if tool_call.function.arguments:
                                tool_calls_accum[idx]["function"]["arguments"] += tool_call.function.arguments

            # Final tool_calls list
            tool_calls = list(tool_calls_accum.values())
            if len(tool_calls) > 1:
                print("warning: more than one tool_call, only keep the first one.")
                tool_calls = [tool_calls[0]]

            # Check if <think> tag is present in content
            if not reasoning_content and content and '</think>' in content:
                reasoning_content = content.split('</think>')[0].strip()
                if '<think>' in reasoning_content:
                    reasoning_content = reasoning_content.split('<think>')[1].strip()
                content = content.split('</think>')[1].strip()
                
            if not content and not tool_calls and not reasoning_content:
                raise ValueError("all content is empty.")
        
            result = {
                "reasoning_content": reasoning_content,
                "tool_calls": tool_calls,
                "content": content
            }
        
            return result
        
        except Exception as e:
            print(f"Something wrong: {e}. Retrying in {retries * 10 + 10} seconds...")
            time.sleep(2)
            retries += 1

    print(f"Failed to get response after {max_retries} retries.")
    return {"reasoning_content": "", "tool_calls": [], "content": ""}


def llm_inference_fc(provider: str, model: str, messages: List[Dict[str, Any]], temperature: float = None, tools: Optional[List[Dict]] = None, enable_thinking: bool = False, api_key: str = None, base_url: str = None) -> Dict[str, Any]:
    """
    Unified LLM inference interface for FC mode.
    """
    if provider == "openai":
        return openai_stream_inference_fc(model=model, messages=messages, temperature=temperature, tools=tools, enable_thinking=enable_thinking, api_key=api_key, base_url=base_url)
    else:
        # add other provider support here
        raise ValueError(f"Invalid provider: {provider}")


def llm_inference_prompt(provider: str, model: str, messages: List[Dict[str, Any]], temperature: float = None, enable_thinking: bool = False, api_key: str = None, base_url: str = None) -> str:
    """
    Unified LLM inference interface for Prompt mode.
    """
    if provider == "openai":
        return openai_stream_inference_prompt(model=model, messages=messages, temperature=temperature, enable_thinking=enable_thinking, api_key=api_key, base_url=base_url)
    else:
        # add other provider support here
        raise ValueError(f"Invalid provider: {provider}")


if __name__ ==  "__main__":
    # Test FC mode with tools
    msgs = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What is the weather in Beijing?"}
    ]

    tools = [
        {
            "type": "function",
            "function": {
                "name": "get_current_weather",
                "description": "Get the current weather of a city",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "city": {"type": "string", "description": "City name"}
                    },
                    "required": ["city"]
                }
            }
        }
    ]

    model = "gpt-4.1"
    provider = "openai"
    result = llm_inference_fc(
        provider=provider,
        model=model, 
        messages=msgs, 
        tools=tools,
    )
    print(result)