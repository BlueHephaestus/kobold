from datetime import datetime

import requests
from apikeys import *
from config import *


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

Here are the most recent summaries given so far, for context:

{self.summaries[-SUMMARIZE_RECENT_SUMMARIES:]}

* Your responses are part of a software pipeline, so only respond with the summary, and nothing else. Do not include any formatting, just the summary text itself. 
* Say "N/A" if nothing important occurred in the text, and ONLY "N/A". 
* If the input is less than 100 words, keep your response less than 100 words.
* DO NOT SAY things along the lines of "No final decision or significant event occurs.", leave the summary short.
* Inputs may have incorrect speech-to-text transcriptions. If it doesn't make sense, don't include it.
* Keep responses to an absolute minimum."""
        print(prompt)
        response = requests.post(
            "https://api.deepseek.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={
                "model": "deepseek-chat",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 500,
                # "temperature": 0.2,
            }
        )
        summary = response.json()["choices"][0]["message"]["content"]
        print(f"\t=> {summary}")
        if summary != "N/A" and not summary.lower().startswith("N/A"):
            # Add to existing summaries
            self.summaries.append({
                "time": datetime.now(),
                "summary": summary
            })
            return True, summary
        else:
            return False, summary

