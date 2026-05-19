
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
                utterance.appendChild(document.createTextNode(currentText + '\\n'));
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

async function startMicrophone() {
    try {
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
            // Convert float32 to int16
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
        audioContext.close();
    }

    isRecording = false;

    // Send termination message
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'terminate' }));
    }

    document.getElementById('startMicBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
    updateStatus('connected', 'Connected');
    addSystemMessage('Transcription stopped');
}

async function uploadFile(file) {
    if (!file) return;

    addSystemMessage(`Processing file: ${file.name}`);

    // Read and send file as binary
    const reader = new FileReader();
    reader.onload = async function(e) {
        const arrayBuffer = e.target.result;
        const int16Array = new Int16Array(arrayBuffer);

        // Send audio chunks
        const chunkSize = 800; // 50ms at 16kHz
        for (let i = 0; i < int16Array.length; i += chunkSize) {
            const chunk = int16Array.slice(i, i + chunkSize);
            const base64Data = btoa(String.fromCharCode.apply(null, new Uint8Array(chunk.buffer)));

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'audio',
                    data: base64Data
                }));
            }

            // Simulate real-time
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Send termination
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
});
