import requests
from apikeys import *

class TranscriptSummarizer:
    def __init__(self):
        self.api_key = DEEPSEEK_API_KEY
        self.summaries = []  # Store summaries for event log

    def summarize_with_assemblyai(self, text: str) -> str:
        """Use AssemblyAI LeMUR for summarization"""
        # LeMUR requires a transcript_id, not raw text
        # You'd need to create a transcript first
        pass

    def summarize_with_deepseek(self, text: str) -> str:
        """Use DeepSeek API for summarization"""

        prompt = f"""Summarize these game transcripts into a concise event log entry (max 100 words):

{text}

Your responses are part of a software pipeline, so only respond with the summary, and nothing else. Do not include any formatting, just the summary text itself. 
Say "N/A" if nothing important occurred, and ONLY "N/A".
If the input is less than 100 words, keep your response less than 100 words.
Inputs may have incorrect speech-to-text transcriptions. If it doesn't make sense, don't include it.
Keep responses to an absolute minimum."""

        response = requests.post(
            "https://api.deepseek.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={
                "model": "deepseek-chat",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 500
            }
        )
        return response.json()["choices"][0]["message"]["content"]