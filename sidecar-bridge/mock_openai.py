"""
File nay la mot mock server de OpenAI, duoc viet bang FastAPI. 
No se mo mot endpoint /chat/completions de nhan cac request tu EnvScaler va tra ve cac chunk du lieu dang stream, giong nhu OpenAI thuc hien. 
Chay file nay de test bridge ma khong can phai goi den OpenAI that.

Cach su dung:
1. Chay file nay: `python mock_openai.py`

2. Mo 1 terminal khac va chay lenh: uvicorn server:app --localhost:8000

3. Mo 1 terminal khac, cd den folder crab-eval/crab-eval va chay: npm run dev

Trong frontend, dat Base URL la: `http://localhost:8080/v1`
API key co the de trong, vi server nay khong can xac thuc.
Ten model co the de bat ky, vi server nay se tra ve ket qua giong nhau cho moi request.

"""

import json
import time
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse
import uvicorn

app = FastAPI(title="Mock OpenAI Server")

def stream_generator():
    """Tạo ra các mảnh dữ liệu (chunks) giả lập quá trình streaming của OpenAI."""
    chunks = ["Xin ", "chào! ", "Tôi ", "là ", "Mock ", "Server ", "đây. ", "Hệ ", "thống ", "của ", "bạn ", "đang ", "hoạt ", "động ", "rất ", "tốt!"]
    
    for chunk in chunks:
        data = {
            "id": "chatcmpl-mock123",
            "object": "chat.completion.chunk",
            "choices": [{
                "index": 0,
                "delta": {"content": chunk},
                "finish_reason": None
            }]
        }
        # Chuẩn SSE của OpenAI yêu cầu format: data: {...}\n\n
        yield f"data: {json.dumps(data)}\n\n"
        time.sleep(0.1)  # Giả lập độ trễ mạng
    
    # Gói tin cuối cùng báo hiệu kết thúc (finish_reason: stop)
    data_final = {
        "id": "chatcmpl-mock123",
        "object": "chat.completion.chunk",
        "choices": [{
            "index": 0,
            "delta": {},
            "finish_reason": "stop"
        }]
    }
    yield f"data: {json.dumps(data_final)}\n\n"
    yield "data: [DONE]\n\n"

@app.post("/v1/chat/completions")
@app.post("/chat/completions")
async def chat_completions(request: Request):
    """Bắt các request gửi đến endpoint /chat/completions"""
    try:
        body = await request.json()
    except Exception:
        body = {}
        
    stream = body.get("stream", False)
    
    # Nếu client yêu cầu stream (EnvScaler thường hay dùng cái này)
    if stream:
        return StreamingResponse(stream_generator(), media_type="text/event-stream")
    
    # Nếu client không yêu cầu stream
    return JSONResponse(content={
        "id": "chatcmpl-mock123",
        "object": "chat.completion",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "Xin chào! Tôi là Mock Server. Hệ thống của bạn đang hoạt động rất tốt (Non-stream)."
            },
            "finish_reason": "stop"
        }]
    })

if __name__ == "__main__":
    print("🚀 Mock OpenAI Server đang chạy tại: http://localhost:8080")
    print("👉 Hãy điền Base URL vào frontend là: http://localhost:8080/v1")
    uvicorn.run(app, host="0.0.0.0", port=8080)
