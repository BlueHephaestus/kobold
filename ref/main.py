import pyaudio
import websocket
import json
import threading
import time
import wave
import textwrap
from urllib.parse import urlencode
from datetime import datetime
import os

# Replace with your chosen API key, this is the "default" account api key
API_KEY = "34ae749110fb4fddb650680f5c850f5c"
CONNECTION_PARAMS = {
    "sample_rate": 16000,
    "speech_model": "u3-rt-pro",
    # "speech_model": "universal-streaming-multilingual", # ends turns pretty quickly
    # "speech_model": "universal-streaming-english", # not good, has inaccuracies
    # "speech_model": "whisper-rt", # no diarization
    "speaker_labels": True,
    "max_speakers": 5
}
API_ENDPOINT_BASE_URL = "wss://streaming.assemblyai.com/v3/ws"
API_ENDPOINT = f"{API_ENDPOINT_BASE_URL}?{urlencode(CONNECTION_PARAMS)}"

# Audio Configuration
FRAMES_PER_BUFFER = 800  # 50ms of audio (0.05s * 16000Hz)
SAMPLE_RATE = CONNECTION_PARAMS["sample_rate"]
CHANNELS = 1
FORMAT = pyaudio.paInt16

# Debug Configuration
DEBUG = True  # Set to False for live microphone streaming
# AUDIO_FILE_PATH = "test_3.wav"  # <-- CHANGE THIS TO YOUR AUDIO FILE PATH
AUDIO_FILE_PATH = "../rar_aug19.wav"
SIMULATE_REAL_TIME = True  # In DEBUG mode, simulate real-time by adding delays between chunks
PLAY_AUDIO = True

# Global variables for audio stream and websocket
audio = None
stream = None
ws_app = None
audio_thread = None
stop_event = threading.Event()  # To signal the audio thread to stop

# WAV recording variables
recorded_frames = []  # Store audio frames for WAV file
recording_lock = threading.Lock()  # Thread-safe access to recorded_frames
output_stream = None

# --- WebSocket Event Handlers ---

def on_open(ws):
    """Called when the WebSocket connection is established."""
    print("WebSocket connection opened.")
    print(f"Connected to: {API_ENDPOINT}")

    if DEBUG:
        print(f"DEBUG MODE: Streaming from audio file: {AUDIO_FILE_PATH}")
        if not SIMULATE_REAL_TIME:
            print("DEBUG MODE: Real-time simulation is OFF. Audio will be sent as fast as possible.")
    else:
        print("LIVE MODE: Streaming from microphone")

    # Start sending audio data in a separate thread
    def stream_audio():
        if DEBUG:
            stream_audio_from_file(ws)
        else:
            stream_audio_from_mic(ws)

    global audio_thread
    audio_thread = threading.Thread(target=stream_audio)
    audio_thread.daemon = True  # Allow main thread to exit even if this thread is running
    audio_thread.start()


def stream_audio_from_mic(ws):
    """Stream audio from microphone (live mode)."""
    global stream
    print("Starting microphone audio streaming...")
    while not stop_event.is_set():
        try:
            audio_data = stream.read(FRAMES_PER_BUFFER, exception_on_overflow=False)

            # Store audio data for WAV recording
            with recording_lock:
                recorded_frames.append(audio_data)

            # Send audio data as binary message
            ws.send(audio_data, websocket.ABNF.OPCODE_BINARY)
        except Exception as e:
            print(f"Error streaming audio from microphone: {e}")
            # If stream read fails, likely means it's closed, stop the loop
            break
    print("Microphone audio streaming stopped.")


def stream_audio_from_file(ws):
    """Stream audio from file (debug mode)."""
    global audio, output_stream
    audio = pyaudio.PyAudio()

    print(f"Starting audio file streaming...")
    time.sleep(2.0) # so the WS can initialize before we start talking

    try:
        # Open the WAV file
        with wave.open(AUDIO_FILE_PATH, 'rb') as wf:
            # Verify audio format
            file_channels = wf.getnchannels()
            file_sampwidth = wf.getsampwidth()
            file_framerate = wf.getframerate()

            print(f"Audio file info: Channels={file_channels}, "
                  f"Sample Width={file_sampwidth}, Frame Rate={file_framerate}")

            # Check if we need to resample
            if file_framerate != SAMPLE_RATE:
                print(f"Warning: File sample rate ({file_framerate}) differs from target ({SAMPLE_RATE})")
                print("Consider converting to 16kHz mono WAV for best results.")

            # Calculate delay for real-time simulation
            chunk_duration = FRAMES_PER_BUFFER / SAMPLE_RATE  # seconds per chunk
            
            # Initialize audio output for playback
            if SIMULATE_REAL_TIME and PLAY_AUDIO:
                try:
                    output_stream = audio.open(
                        format=audio.get_format_from_width(file_sampwidth),
                        channels=file_channels,
                        rate=file_framerate,
                        output=True,
                        frames_per_buffer=FRAMES_PER_BUFFER
                    )
                    print("Audio playback enabled - you should hear the audio")
                except Exception as e:
                    print(f"Could not initialize audio playback: {e}")
                    output_stream = None

            # Read and send audio data in chunks
            while not stop_event.is_set():
                # Read a chunk of audio data
                audio_data = wf.readframes(FRAMES_PER_BUFFER)

                # If no more data, we've reached the end of the file
                if not audio_data:
                    print("\nReached end of audio file.")
                    break

                # Store audio data for WAV recording
                with recording_lock:
                    recorded_frames.append(audio_data)

                # Send audio data as binary message
                ws.send(audio_data, websocket.ABNF.OPCODE_BINARY)
                
                # Play audio if in real-time mode
                if SIMULATE_REAL_TIME and output_stream:
                    try:
                        output_stream.write(audio_data)
                    except Exception as e:
                        print(f"Error playing audio: {e}")

                # Simulate real-time by sleeping for the duration of the chunk
                if SIMULATE_REAL_TIME:
                    time.sleep(chunk_duration)

            print("Finished streaming audio file.")

    except FileNotFoundError:
        print(f"Error: Audio file not found at {AUDIO_FILE_PATH}")
        print("Please update AUDIO_FILE_PATH with the correct path to your audio file.")
        print("Or set DEBUG=False to use microphone streaming.")
    except Exception as e:
        print(f"Error streaming audio from file: {e}")

    # Send termination message after file is done (only in debug mode)
    if DEBUG and not stop_event.is_set():
        print("Audio file streaming complete. Sending termination...")
        try:
            terminate_message = {"type": "Terminate"}
            print(f"Sending termination message: {json.dumps(terminate_message)}")
            ws.send(json.dumps(terminate_message))
        except Exception as e:
            print(f"Error sending termination message: {e}")

def print_transcript(data):
    # transcript = data.get('transcript', '')
    transcript = data.get('utterance', '')
    # formatted = data.get('turn_is_formatted', False)
    # speaker_label = data.get('speaker_label', 'UNKNOWN')
    words = data.get('words', [])
    # Form each utterance by separating by sections with each speaker in the transcript
    utterance = ""
    speaker = ""
    for word in words:
        word_text = word.get('text', '')
        word_speaker = f"[{word.get('speaker', '?')}]"
        if word_speaker != speaker and word_speaker != "?" and speaker != "":
            print(utterance)
            utterance = ""
            speaker = word_speaker

        if len(utterance) == 0:
            utterance = word_speaker
        utterance += " " + word_text
        speaker = word_speaker

    # if formatted:
    print(utterance)
    # print('\r' + ' ' * 80 + '\r', end='')
    # transcript = f"{speaker_label}: {transcript}"
    # transcript = textwrap.fill(transcript, width=80, subsequent_indent="\t")
    # print(transcript)
    # else:
    #     print(f"\r{transcript}", end='')


def on_message(ws, message):
    try:
        data = json.loads(message)
        msg_type = data.get('type')

        if msg_type == "Begin":
            session_id = data.get('id')
            expires_at = data.get('expires_at')
            print(f"\nSession began: ID={session_id}, ExpiresAt={datetime.fromtimestamp(expires_at)}")
        elif msg_type == "Turn": # End of utterance
            if data.get('end_of_turn', False): # only output once finalized

                # Clear previous line for formatted messages
                print_transcript(data)
        elif msg_type == "Termination":
            audio_duration = data.get('audio_duration_seconds', 0)
            session_duration = data.get('session_duration_seconds', 0)
            print(f"\nSession Terminated: Audio Duration={audio_duration}s, Session Duration={session_duration}s")
    except json.JSONDecodeError as e:
        print(f"Error decoding message: {e}")
    except Exception as e:
        print(f"Error handling message: {e}")


def on_error(ws, error):
    """Called when a WebSocket error occurs."""
    print(f"\nWebSocket Error: {error}")
    # Attempt to signal stop on error
    stop_event.set()


def on_close(ws, close_status_code, close_msg):
    """Called when the WebSocket connection is closed."""
    print(f"\nWebSocket Disconnected: Status={close_status_code}, Msg={close_msg}")

    # Save recorded audio to WAV file
    save_wav_file()

    # Ensure audio resources are released
    global stream, audio
    stop_event.set()  # Signal audio thread just in case it's still running

    if stream:
        if stream.is_active():
            stream.stop_stream()
        stream.close()
        stream = None
    if audio:
        audio.terminate()
        audio = None
    # Try to join the audio thread to ensure clean exit
    if audio_thread and audio_thread.is_alive():
        audio_thread.join(timeout=1.0)


def save_wav_file():
    """Save recorded audio frames to a WAV file."""
    if not recorded_frames:
        print("No audio data recorded.")
        return

    # Generate filename with timestamp
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    mode_prefix = "debug" if DEBUG else "live"
    filename = f"{mode_prefix}_recording_{timestamp}.wav"

    try:
        with wave.open(filename, 'wb') as wf:
            wf.setnchannels(CHANNELS)
            wf.setsampwidth(2)  # 16-bit = 2 bytes
            wf.setframerate(SAMPLE_RATE)

            # Write all recorded frames
            with recording_lock:
                wf.writeframes(b''.join(recorded_frames))

        print(f"Audio saved to: {filename}")
        print(f"Duration: {len(recorded_frames) * FRAMES_PER_BUFFER / SAMPLE_RATE:.2f} seconds")

    except Exception as e:
        print(f"Error saving WAV file: {e}")


# --- Main Execution ---
def run():
    global audio, stream, ws_app

    # Display mode information
    if DEBUG:
        print("=" * 50)
        print("RUNNING IN DEBUG MODE")
        print("=" * 50)

        # Check if audio file exists
        if not os.path.exists(AUDIO_FILE_PATH):
            print(f"Error: Audio file not found at: {AUDIO_FILE_PATH}")
            print("Please update AUDIO_FILE_PATH with the correct path to your WAV file.")
            print("The file should be a 16kHz, mono, 16-bit WAV file for best results.")
            print("Or set DEBUG=False to use microphone streaming.")
            return

        print(f"Audio file: {AUDIO_FILE_PATH}")
        print(f"Real-time simulation: {'ON' if SIMULATE_REAL_TIME else 'OFF'}")
    else:
        print("=" * 50)
        print("RUNNING IN LIVE MODE")
        print("=" * 50)

        # Initialize PyAudio and open microphone stream
        audio = pyaudio.PyAudio()

        try:
            stream = audio.open(
                input=True,
                frames_per_buffer=FRAMES_PER_BUFFER,
                channels=CHANNELS,
                format=FORMAT,
                rate=SAMPLE_RATE,
            )
            print("Microphone stream opened successfully.")
        except Exception as e:
            print(f"Error opening microphone stream: {e}")
            if audio:
                audio.terminate()
            return  # Exit if microphone cannot be opened

    print("Press Ctrl+C to stop.")

    # Create WebSocketApp
    ws_app = websocket.WebSocketApp(
        API_ENDPOINT,
        header={"Authorization": API_KEY},
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
    )

    # Run WebSocketApp in a separate thread to allow main thread to catch KeyboardInterrupt
    ws_thread = threading.Thread(target=ws_app.run_forever)
    ws_thread.daemon = True
    ws_thread.start()

    try:
        # Keep main thread alive until interrupted or keep it alive if we're simulating real-time audio with a file without real-time simulation
        while ws_thread.is_alive() and ((DEBUG and not SIMULATE_REAL_TIME) or (audio_thread is None or audio_thread.is_alive())):
            time.sleep(0.1)
    except KeyboardInterrupt:
        print("\nCtrl+C received. Stopping...")
        stop_event.set()  # Signal audio thread to stop

        # Send termination message to the server
        if ws_app and ws_app.sock and ws_app.sock.connected:
            try:
                terminate_message = {"type": "Terminate"}
                print(f"Sending termination message: {json.dumps(terminate_message)}")
                ws_app.send(json.dumps(terminate_message))
                # Give a moment for messages to process before forceful close
                time.sleep(5 if not DEBUG else 2)
            except Exception as e:
                print(f"Error sending termination message: {e}")

        # Close the WebSocket connection (will trigger on_close)
        if ws_app:
            ws_app.close()

        # Wait for WebSocket thread to finish
        ws_thread.join(timeout=2.0)

    except Exception as e:
        print(f"\nAn unexpected error occurred: {e}")
        stop_event.set()
        if ws_app:
            ws_app.close()
        ws_thread.join(timeout=2.0)

    finally:
        # Final cleanup (already handled in on_close, but good as a fallback)
        if stream and stream.is_active():
            stream.stop_stream()
        if stream:
            stream.close()
        if audio:
            audio.terminate()
        print("Cleanup complete. Exiting.")


if __name__ == "__main__":
    run()