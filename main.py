from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi import Request
from fastapi.staticfiles import StaticFiles
import websocket
import json
import threading
import asyncio
from urllib.parse import urlencode
from datetime import datetime
import base64
import os
from TranscriptSummarizer import TranscriptSummarizer
from ConnectionManager import ConnectionManager
from config import *
from secrets import * # where api keys are defined


app = FastAPI()
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")

API_ENDPOINT_BASE_URL = "wss://streaming.assemblyai.com/v3/ws"
API_ENDPOINT = f"{API_ENDPOINT_BASE_URL}?{urlencode(CONNECTION_PARAMS)}"

manager = ConnectionManager()

def create_assembly_connection(client_id: str):
    """Create a connection to AssemblyAI for a specific client"""

    def on_open(ws):
        print(f"[Client {client_id}] AssemblyAI connection opened")

    def on_message(ws, message):
        # Forward message from AssemblyAI to client
        asyncio.run(manager.send_message(client_id, message))

    def on_error(ws, error):
        print(f"[Client {client_id}] AssemblyAI error: {error}")
        asyncio.run(manager.send_message(client_id, json.dumps({"type": "error", "error": str(error)})))

    def on_close(ws, close_status_code, close_msg):
        print(f"[Client {client_id}] AssemblyAI connection closed")

    # Create WebSocket connection to AssemblyAI
    assembly_ws = websocket.WebSocketApp(
        API_ENDPOINT,
        header={"Authorization": ASSEMBLY_API_KEY},
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
    )

    # Run in separate thread
    ws_thread = threading.Thread(target=assembly_ws.run_forever)
    ws_thread.daemon = True
    ws_thread.start()

    return assembly_ws, ws_thread


@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await manager.connect(client_id, websocket)

    # Add buffer to process for event log
    transcript_buffer = []
    
    # Start summarization thread
    manager.start_summary_thread(client_id, transcript_buffer)

    # Create AssemblyAI connection
    assembly_ws, ws_thread = create_assembly_connection(client_id)
    manager.active_connections[client_id]["assembly_ws"] = assembly_ws

    try:
        while True:
            # Receive audio data from client
            data = await websocket.receive_text()

            try:
                message = json.loads(data)

                if message["type"] == "audio":
                    # Decode base64 audio and send to AssemblyAI
                    audio_bytes = base64.b64decode(message["data"])
                    if assembly_ws and assembly_ws.sock and assembly_ws.sock.connected:
                        assembly_ws.send(audio_bytes, opcode=0x2)

                elif message["type"] == "transcript":
                    # Collect transcript text for summarization
                    transcript_buffer.append(message["text"])

                elif message["type"] == "terminate":
                    # Send termination to AssemblyAI
                    if assembly_ws and assembly_ws.sock and assembly_ws.sock.connected:
                        terminate_msg = json.dumps({"type": "Terminate"})
                        assembly_ws.send(terminate_msg)
                    break

            except json.JSONDecodeError:
                pass

    except WebSocketDisconnect:
        print(f"[Client {client_id}] Disconnected")

    finally:
        # Clean up
        if assembly_ws and assembly_ws.sock and assembly_ws.sock.connected:
            assembly_ws.close()
        # Clean up timer
        if client_id in manager.summary_timers:
            manager.summary_timers[client_id].cancel()
        manager.disconnect(client_id)


@app.get("/")
async def get(request: Request):
    # return HTMLResponse(content=HTML_PAGE)
    return templates.TemplateResponse(request=request, name="index.html")
    return

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)