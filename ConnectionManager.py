import json
import asyncio
import threading
from datetime import datetime

from fastapi import WebSocket

from TranscriptSummarizer import TranscriptSummarizer
from config import *


# Store active connections
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict = {}  # client_id -> {client_ws, assembly_ws}
        self.summarizer = TranscriptSummarizer()
        self.summary_timers: dict = {}  # client_id -> timer
        self.summaries = []

    async def connect(self, client_id: str, client_ws: WebSocket):
        await client_ws.accept()
        self.active_connections[client_id] = {
            "client_ws": client_ws,
            "assembly_ws": None,
            "audio_buffer": []
        }

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]

    async def send_message(self, client_id: str, message: str):
        if client_id in self.active_connections:
            await self.active_connections[client_id]["client_ws"].send_text(message)

    def start_summary_thread(self, client_id: str, transcript_buffer: list):
        """Start periodic summarization"""

        def summarize_periodically():
            print("SUMMARIZING")
            if client_id in self.active_connections:
                # Get accumulated text
                buffer_copy = transcript_buffer.copy()
                if buffer_copy:
                    text = "\n".join(buffer_copy)
                    transcript_buffer.clear()

                    # Generate summary
                    summary = self.summarizer.summarize_with_deepseek(text)
                    if summary != "N/A" and not summary.lower().startswith("N/A"):

                        # Send to client
                        asyncio.run(self.send_message(client_id, json.dumps({
                            "type": "summary",
                            "timestamp": datetime.now().isoformat(),
                            "content": summary
                        })))

                        # Store in event log
                        self.summaries.append({
                            "time": datetime.now(),
                            "summary": summary
                        })

            # Schedule next run
            self.summary_timers[client_id] = threading.Timer(SUMMARIZE_INTERVAL, summarize_periodically)
            self.summary_timers[client_id].start()

        # Start the first timer
        self.summary_timers[client_id] = threading.Timer(SUMMARIZE_INTERVAL, summarize_periodically)
        self.summary_timers[client_id].start()
