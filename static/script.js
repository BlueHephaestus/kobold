// config constants
const chunkSize = 800;
const delayMs = 10; // small throttle

let ws = null;
let mediaRecorder = null;
let audioContext = null;
let isRecording = false;
let clientId = 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

// Connect WebSocket
function connect() {
    ws = new WebSocket(`ws://localhost:8000/ws/${clientId}`);

    ws.onopen = function() {
        updateStatus('connected', 'Connected');
        document.getElementById('startMicBtn').disabled = false;
        document.querySelector('.file-label').style.opacity = '1';
        // Pause button remains disabled until we've actually started microphone
        document.getElementById('pauseBtn').disabled = true;

    };

    ws.onmessage = function(event) {
        const data = JSON.parse(event.data);
        // Handle summary messages
        if (data.type === 'summary') {
            console.log('Summary received:', data.content);
            addToEventLog(data.timestamp, data.content);
            // Handle AssemblyAI Messages
        } else if (data.type === 'Turn' || data.type === 'error') {
            // Send it back to the backend for summarization now that it's here
            if (ws && ws.readyState === WebSocket.OPEN) {
                console.log(data);
                console.log('Transcribed utterance:', data.utterance);
                ws.send(JSON.stringify({
                    type: 'transcript',
                    text: data.utterance //|| extractTextFromWords(data.words)
                }));
            }
            handleAssemblyAIMessage(data);
        }
    };
    ws.onerror = function(error) {
        console.error('WebSocket error:', error);
        updateStatus('disconnected', 'Connection Error');
    };

    ws.onclose = function() {
        updateStatus('disconnected', 'Disconnected');
        document.getElementById('startMicBtn').disabled = true;
        document.getElementById('pauseBtn').disabled = true;
        document.getElementById('stopBtn').disabled = true;
        if (mediaRecorder) {
            mediaRecorder.stop();
        }
    };
}

function handleAssemblyAIMessage(data) {
    const msgType = data.type;

    if (msgType === 'Turn' && data.end_of_turn) {
        // Display the transcribed utterance
        displayUtterance(data);
    } else if (msgType === 'error') {
        console.error('AssemblyAI error:', data.error);
        console.log(data);
        addSystemMessage('Error: ' + data.error);
    }
}

function addToEventLog(timestamp, summary) {
    const logDiv = document.getElementById('eventLog');
    const entry = document.createElement('div');
    entry.className = 'event-entry';
    entry.innerHTML = `
                <div class="event-time">${new Date(timestamp).toLocaleTimeString()}</div>
                <div class="event-summary">${summary}</div>
                <hr>
            `;
    logDiv.insertBefore(entry, logDiv.firstChild);
}


function displayUtterance(data) {
    const transcriptDiv = document.getElementById('transcript');

    // Remove placeholder if present
    if (transcriptDiv.children.length === 1 && transcriptDiv.children[0].style?.color === 'rgb(153, 153, 153)') {
        transcriptDiv.innerHTML = '';
    }

    // Build utterance text with speaker labels
    let utterance = document.createElement('div');
    utterance.className = 'utterance';

    let currentSpeaker = '';
    let currentText = '';

    if (data.words) {
        for (let word of data.words) {
            const speaker = word.speaker ? `Speaker ${word.speaker}` : 'Unknown';
            if (speaker !== currentSpeaker && currentSpeaker !== '') {
                // Add previous speaker's text
                const speakerSpan = document.createElement('span');
                speakerSpan.className = 'speaker';
                speakerSpan.textContent = currentSpeaker + ': ';
                utterance.appendChild(speakerSpan);
                utterance.appendChild(document.createTextNode(currentText + '\n'));
                currentText = '';
            }
            currentSpeaker = speaker;
            currentText += (currentText ? ' ' : '') + word.text;
        }

        // Add last speaker's text
        if (currentText) {
            const speakerSpan = document.createElement('span');
            speakerSpan.className = 'speaker';
            speakerSpan.textContent = currentSpeaker + ': ';
            utterance.appendChild(speakerSpan);
            utterance.appendChild(document.createTextNode(currentText));
        }
    } else if (data.utterance) {
        const speaker = data.speaker_label ? `Speaker ${data.speaker_label}` : 'Unknown';
        const speakerSpan = document.createElement('span');
        speakerSpan.className = 'speaker';
        speakerSpan.textContent = speaker + ': ';
        utterance.appendChild(speakerSpan);
        utterance.appendChild(document.createTextNode(data.utterance));
    }

    transcriptDiv.appendChild(utterance);
    transcriptDiv.scrollTop = transcriptDiv.scrollHeight;
}

function addSystemMessage(message) {
    const transcriptDiv = document.getElementById('transcript');
    const msgDiv = document.createElement('div');
    msgDiv.style.color = '#666';
    msgDiv.style.fontStyle = 'italic';
    msgDiv.style.padding = '5px';
    msgDiv.textContent = message;
    transcriptDiv.appendChild(msgDiv);
    transcriptDiv.scrollTop = transcriptDiv.scrollHeight;
}

function updateStatus(status, message) {
    const statusDiv = document.getElementById('status');
    statusDiv.className = `status ${status}`;
    statusDiv.textContent = message;
}

function togglePause() {
    // Pause or resume sending audio frames
    if (!audioContext) return;

    const pauseBtn = document.getElementById('pauseBtn');

    if (isRecording) {
        // Pause: stop sending frames but keep stream/context alive
        isRecording = false;
        pauseBtn.textContent = 'Resume';
        updateStatus('paused', 'Paused');
        addSystemMessage('Transcription paused');
    } else {
        // Resume: restart sending frames
        audioContext.resume().catch(() => {});
        isRecording = true;
        pauseBtn.textContent = 'Pause';
        updateStatus('recording', 'Recording...');
        addSystemMessage('Transcription resumed');
    }
}

async function startMicrophone() {
    try {
        // If an AudioContext already exists (paused), resume and reuse it
        if (audioContext && audioContext.state !== 'closed') {
            await audioContext.resume();
            isRecording = true;
            document.getElementById('startMicBtn').disabled = true;
            document.getElementById('stopBtn').disabled = false;
            document.getElementById('pauseBtn').disabled = false;
            document.getElementById('pauseBtn').textContent = 'Pause';
            updateStatus('recording', 'Recording...');
            addSystemMessage('Microphone recording resumed');
            return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Create AudioContext for resampling to 16kHz
        audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 16000
        });

        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);

        source.connect(processor);
        processor.connect(audioContext.destination);

        processor.onaudioprocess = function(e) {
            if (!isRecording) return;

            const inputData = e.inputBuffer.getChannelData(0);
            // Convert float32 to int16 (this is what assembly AI expects)
            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                pcmData[i] = Math.max(-32768, Math.min(32767, Math.floor(inputData[i] * 32767)));
            }

            // Send audio data if WebSocket is connected
            if (ws && ws.readyState === WebSocket.OPEN) {
                const base64Data = btoa(String.fromCharCode.apply(null, new Uint8Array(pcmData.buffer)));
                ws.send(JSON.stringify({
                    type: 'audio',
                    data: base64Data
                }));
            }
        };

        audioContext.resume();
        isRecording = true;

        document.getElementById('startMicBtn').disabled = true;
        document.getElementById('pauseBtn').disabled = false;
        // document.getElementById('pauseBtn').textContent = 'Pause';

        document.getElementById('stopBtn').disabled = false;
        updateStatus('recording', 'Recording...');
        addSystemMessage('Microphone recording started');

    } catch (error) {
        console.error('Error accessing microphone:', error);
        addSystemMessage('Error: Could not access microphone');
    }
}

function stopTranscription() {
    if (mediaRecorder) {
        mediaRecorder.stop();
    }

    if (audioContext) {
        // Close the audio context to release resources
        audioContext.close().catch(() => {});
        audioContext = null;
    }

    isRecording = false;

    // Send termination message
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'terminate' }));
    }

    document.getElementById('startMicBtn').disabled = false;
    document.getElementById('pauseBtn').disabled = true;
    document.getElementById('stopBtn').disabled = true;
    updateStatus('connected', 'Connected');
    addSystemMessage('Transcription stopped');
}

async function uploadFile(file) {
    if (!file) return;

    addSystemMessage(`Processing file: ${file.name}`);

    // Read file as ArrayBuffer
    const reader = new FileReader();
    reader.onload = async function(e) {
        const arrayBuffer = e.target.result;
        const int16Array = new Int16Array(arrayBuffer);

        // Larger chunks reduce frame count; small delay prevents rapid-fire frames
        // const chunkSize = document.hidden ? 3200 : 1600; // hidden: bigger chunks

        const sleep = (ms) => new Promise(res => setTimeout(res, ms));

        for (let i = 0; i < int16Array.length; i += chunkSize) {
            const chunk = int16Array.slice(i, i + chunkSize);
            const base64Data = btoa(String.fromCharCode.apply(null, new Uint8Array(chunk.buffer)));

            // wait for socket to be open
            const waitForOpen = async (timeout = 2000) => {
                const start = Date.now();
                while ((!ws || ws.readyState !== WebSocket.OPEN) && (Date.now() - start) < timeout) {
                    await sleep(50);
                }
                return ws && ws.readyState === WebSocket.OPEN;
            };

            if (!(await waitForOpen())) {
                addSystemMessage('WebSocket not open; aborting file upload');
                break;
            }

            try {
                ws.send(JSON.stringify({ type: 'audio', data: base64Data }));
            } catch (err) {
                console.error('Send error during uploadFile:', err);
                addSystemMessage('Error sending audio chunk');
                break;
            }

            // tiny throttle to avoid overwhelming AssemblyAI
            // it will close the connection if this is too small
            await sleep(delayMs);
        }

        // Send termination if still connected
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'terminate' }));
        }

        addSystemMessage('File processing complete');
    };

    reader.readAsArrayBuffer(file);
}

// Initialize connection
connect();

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    if (ws) {
        ws.close();
    }
    if (audioContext) {
        audioContext.close().catch(() => {});
    }
});
