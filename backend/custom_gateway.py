"""
Custom API Gateway wrapper for internal company models.
Wraps OpenAI client with custom headers/authentication.
"""

import os
import time
from typing import List, Dict, Any, Optional
from openai import OpenAI
import httpx


def create_custom_client(
    api_key: str,
    base_url: str,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 120
) -> OpenAI:
    """
    Create OpenAI client with custom headers and timeout.
    
    Args:
        api_key: API key for authentication
        base_url: Custom API gateway endpoint (e.g., https://api.company.com/v1)
        headers: Extra headers (e.g., {"X-Custom-Header": "value"})
        timeout: Request timeout in seconds
    
    Returns:
        Configured OpenAI client
    """
    
    # Merge headers
    default_headers = {
        "Content-Type": "application/json",
    }
    if headers:
        default_headers.update(headers)
    
    # Create custom HTTP client with headers and timeout
    http_client = httpx.Client(
        headers=default_headers,
        timeout=timeout,
    )
    
    client = OpenAI(
        api_key=api_key or os.getenv("COMPANY_API_KEY"),
        base_url=base_url or os.getenv("COMPANY_API_BASE_URL"),
        http_client=http_client,
    )
    
    return client


def custom_gateway_stream_inference_fc(
    model: str,
    messages: List[Dict[str, Any]],
    temperature: float = None,
    tools: Optional[List[Dict]] = None,
    enable_thinking: bool = False,
    api_key: str = None,
    base_url: str = None,
    custom_headers: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    Streaming inference via custom API gateway (OpenAI-compatible).
    
    Args:
        model: Model name on your gateway
        messages: Chat messages
        temperature: Sampling temperature
        tools: Tool definitions (optional)
        enable_thinking: Enable thinking mode (if supported)
        api_key: API key (or use env var COMPANY_API_KEY)
        base_url: Gateway endpoint (or use env var COMPANY_API_BASE_URL)
        custom_headers: Extra headers (e.g., authorization headers)
    
    Returns:
        Result dict with content, tool_calls, etc.
    """
    
    client = create_custom_client(
        api_key=api_key,
        base_url=base_url,
        headers=custom_headers,
        timeout=120
    )
    
    retries = 0
    max_retries = 10
    
    while retries < max_retries:
        try:
            params = {
                "model": model,
                "messages": messages,
                "stream": True,
                "temperature": temperature or 0.7,
                "max_tokens": 10000,
            }
            
            # Only add tools if provided
            if tools:
                params["tools"] = tools
                params["tool_choice"] = "auto"
            
            # Optional: add extra_body for custom parameters
            # params["extra_body"] = {"enable_thinking": enable_thinking}
            
            completion = client.chat.completions.create(**params)
            
            reasoning_content = ""
            content = ""
            tool_calls_accum: Dict[int, Dict[str, Any]] = {}
            
            # Stream processing
            for chunk in completion:
                if not getattr(chunk, "choices", None):
                    continue
                
                choice = chunk.choices[0]
                delta = choice.delta
                
                # Accumulate content
                if hasattr(delta, "content") and delta.content:
                    content += delta.content
                
                # Accumulate tool calls
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
                        if tool_call.function and tool_call.function.name:
                            tool_calls_accum[idx]["function"]["name"] += tool_call.function.name
                        if tool_call.function and tool_call.function.arguments:
                            tool_calls_accum[idx]["function"]["arguments"] += tool_call.function.arguments
            
            tool_calls = list(tool_calls_accum.values())
            if len(tool_calls) > 1:
                print(f"[WARNING] Multiple tool calls detected, keeping only first")
                tool_calls = [tool_calls[0]]
            
            if not content and not tool_calls:
                raise ValueError("Empty response from model")
            
            return {
                "reasoning_content": reasoning_content,
                "tool_calls": tool_calls,
                "content": content,
            }
        
        except Exception as e:
            print(f"[RETRY {retries + 1}/{max_retries}] Error: {e}")
            time.sleep(retries * 10 + 10)
            retries += 1
    
    return {"reasoning_content": "", "tool_calls": [], "content": ""}


def custom_gateway_stream_inference_prompt(
    model: str,
    messages: List[Dict[str, Any]],
    temperature: float = None,
    enable_thinking: bool = False,
    api_key: str = None,
    base_url: str = None,
    custom_headers: Optional[Dict[str, str]] = None,
) -> str:
    """
    Streaming inference via custom API gateway (prompt mode).
    """
    
    client = create_custom_client(
        api_key=api_key,
        base_url=base_url,
        headers=custom_headers,
        timeout=120
    )
    
    retries = 0
    max_retries = 10
    
    while retries < max_retries:
        try:
            params = {
                "model": model,
                "messages": messages,
                "stream": True,
                "temperature": temperature or 0.7,
                "max_tokens": 10000,
            }
            
            completion = client.chat.completions.create(**params)
            
            content = ""
            for chunk in completion:
                if not getattr(chunk, "choices", None):
                    continue
                choice = chunk.choices[0]
                if hasattr(choice.delta, "content") and choice.delta.content:
                    content += choice.delta.content
            
            if not content:
                raise ValueError("Empty response from model")
            
            return content
        
        except Exception as e:
            print(f"[RETRY {retries + 1}/{max_retries}] Error: {e}")
            time.sleep(retries * 10 + 10)
            retries += 1
    
    return ""