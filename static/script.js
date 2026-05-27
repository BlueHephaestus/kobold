// config constants
// const chunkSize = 800;
// const delayMs = 10; // small throttle
const chunkSize = 3200;
const sampleRate = 16000; // 16kHz
//delayMs = chunkSize / sampleRate, since in real time, sampleRate * ms duration = # of frames
//e.g. 0.05s (50ms) of 16000Hz is 800 frames. So we can algebra to get another formula.

let utteranceCounter = 0; // increments for each appended utterance (used as a stable sequence)
const speakerRenames = {}; // { speakerKey: [{ from: number, name: string }, ...] }

let ws = null;
let mediaRecorder = null;
let audioContext = null;
let audioWorkletNode = null;
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

// helper: return display name for a speakerKey at a given utterance index
function getDisplayName(speakerKey, index) {
    const list = speakerRenames[speakerKey];
    if (!list || list.length === 0) return speakerKey;
    // find the last rename whose from <= index
    let chosen = speakerKey;
    for (let i = 0; i < list.length; i++) {
        if (list[i].from <= index) chosen = list[i].name;
        else break;
    }
    return chosen;
}

function displayUtterance(data) {
    const transcriptDiv = document.getElementById('transcript');

    // Remove placeholder if present
    if (transcriptDiv.children.length === 1 && transcriptDiv.children[0].style?.color === 'rgb(153, 153, 153)') {
        transcriptDiv.innerHTML = '';
    }

    // Build utterance element (container)
    let utteranceEl = document.createElement('div');
    utteranceEl.className = 'utterance';
    // this utterance's stable index
    const thisIndex = utteranceCounter;

    if (data.words) {
        // group words by speaker inside this utterance container
        let currentSpeakerKey = '';
        let currentText = '';

        for (let word of data.words) {
            const speakerKey = word.speaker ? `Speaker ${word.speaker}` : 'Unknown';
            if (speakerKey !== currentSpeakerKey && currentSpeakerKey !== '') {
                // flush previous speaker block
                const speakerSpan = document.createElement('span');
                speakerSpan.className = 'speaker';
                speakerSpan.dataset.speakerKey = currentSpeakerKey;
                speakerSpan.dataset.utteranceIndex = String(thisIndex);
                speakerSpan.textContent = getDisplayName(currentSpeakerKey, thisIndex) + ': ';
                utteranceEl.appendChild(speakerSpan);
                utteranceEl.appendChild(document.createTextNode(currentText + '\n'));
                currentText = '';
            }
            currentSpeakerKey = speakerKey;
            currentText += (currentText ? ' ' : '') + word.text;
        }

        // flush last speaker block
        if (currentText) {
            const speakerSpan = document.createElement('span');
            speakerSpan.className = 'speaker';
            speakerSpan.dataset.speakerKey = currentSpeakerKey;
            speakerSpan.dataset.utteranceIndex = String(thisIndex);
            speakerSpan.textContent = getDisplayName(currentSpeakerKey, thisIndex) + ': ';
            utteranceEl.appendChild(speakerSpan);
            utteranceEl.appendChild(document.createTextNode(currentText));
        }
    } else if (data.utterance) {
        const speakerKey = data.speaker_label ? `Speaker ${data.speaker_label}` : 'Unknown';
        const speakerSpan = document.createElement('span');
        speakerSpan.className = 'speaker';
        speakerSpan.dataset.speakerKey = speakerKey;
        speakerSpan.dataset.utteranceIndex = String(thisIndex);
        speakerSpan.textContent = getDisplayName(speakerKey, thisIndex) + ': ';
        utteranceEl.appendChild(speakerSpan);
        utteranceEl.appendChild(document.createTextNode(data.utterance));
    }

    // Append and scroll
    transcriptDiv.appendChild(utteranceEl);
    transcriptDiv.scrollTop = transcriptDiv.scrollHeight;

    // increment for the next utterance
    utteranceCounter++;
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
    if (!audioContext || !audioWorkletNode) return;

    const pauseBtn = document.getElementById('pauseBtn');

    if (isRecording) {
        // Pause: stop sending frames but keep stream/context alive
        isRecording = false;
        audioWorkletNode.port.postMessage({ type: 'enabled', enabled: false });
        pauseBtn.textContent = 'Resume';
        updateStatus('paused', 'Paused');
        addSystemMessage('Transcription paused');
    } else {
        // Resume: restart sending frames
        isRecording = true;
        audioWorkletNode.port.postMessage({ type: 'enabled', enabled: true });
        audioContext.resume().catch(() => {});
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
            if (audioWorkletNode) audioWorkletNode.port.postMessage({ type: 'enabled', enabled: true });
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
            sampleRate: sampleRate
        });
        // load worklet module
        await audioContext.audioWorklet.addModule('/static/pcm-processor.js');

        // create worklet node: one output so it's connected
        audioWorkletNode = new AudioWorkletNode(audioContext, 'pcm-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
        });

        // configure chunk size on worklet
        audioWorkletNode.port.postMessage({ type: 'config', chunkSize: chunkSize });

        // handle incoming chunks from worklet
        audioWorkletNode.port.onmessage = async (e) => {
            const data = e.data;
            if (!data || data.type !== 'chunk') return;
            const ab = data.buffer;
            // convert bytes to base64 (safe for small chunks)
            try {
                const uint8 = new Uint8Array(ab);
                let binary = '';
                // Convert in blocks to avoid apply\(\) size limits
                const BLOCK = 0x8000;
                for (let i = 0; i < uint8.length; i += BLOCK) {
                    const slice = uint8.subarray(i, Math.min(i + BLOCK, uint8.length));
                    binary += String.fromCharCode.apply(null, slice);
                }
                const base64Data = btoa(binary);

                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'audio', data: base64Data }));
                }
            } catch (err) {
                console.error('Error encoding/sending audio chunk:', err);
            }
        };

        const source = audioContext.createMediaStreamSource(stream);
        // const processor = audioContext.createScriptProcessor(4096, 1, 1);

        // Route worklet -> muted gain -> destination so the node stays alive but silent
        const silentGain = audioContext.createGain();
        silentGain.gain.value = 0;

        source.connect(audioWorkletNode);
        audioWorkletNode.connect(silentGain)
        silentGain.connect(audioContext.destination)
        // processor.connect(audioContext.destination);

        // processor.onaudioprocess = function(e) {
        //     if (!isRecording) return;
        //
        //     const inputData = e.inputBuffer.getChannelData(0);
        //     // Convert float32 to int16 (this is what assembly AI expects)
        //     const pcmData = new Int16Array(inputData.length);
        //     for (let i = 0; i < inputData.length; i++) {
        //         pcmData[i] = Math.max(-32768, Math.min(32767, Math.floor(inputData[i] * 32767)));
        //     }
        //
        //     // Send audio data if WebSocket is connected
        //     if (ws && ws.readyState === WebSocket.OPEN) {
        //         const base64Data = btoa(String.fromCharCode.apply(null, new Uint8Array(pcmData.buffer)));
        //         ws.send(JSON.stringify({
        //             type: 'audio',
        //             data: base64Data
        //         }));
        //     }
        // };

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
    if (mediaRecorder) { // TODO REMOVE?
        mediaRecorder.stop();
    }
    if (audioWorkletNode) {
        try {
            audioWorkletNode.port.postMessage({ type: 'enabled', enabled: false });
            audioWorkletNode.disconnect();
            audioWorkletNode = null;
        } catch (e) {}
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
        const delayMs = chunkSize / sampleRate * 1000 // dynamically compute how long to simulate delay

        for (let i = 0; i < int16Array.length; i += chunkSize) {
            const chunk = int16Array.slice(i, i + chunkSize);
            const base64Data = btoa(String.fromCharCode.apply(null, new Uint8Array(chunk.buffer)));

            // wait for socket to be open
            const waitForOpen = async (timeout = 2000) => {
                const start = Date.now();
                while ((!ws || ws.readyState !== WebSocket.OPEN) && (Date.now() - start) < timeout) {
                    await sleep(50); // fixed small delay
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
            // if this doesn't match the audio, assemblyAI will lose its shit
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

document.getElementById('transcript').addEventListener('dblclick', function (ev) {
    const target = ev.target;
    if (!target || !target.classList || !target.classList.contains('speaker')) return;

    ev.preventDefault();
    const span = target;
    const speakerKey = span.dataset.speakerKey || span.textContent.replace(/:\s*$/, '').trim();
    const utterIdx = parseInt(span.dataset.utteranceIndex || '0', 10);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'speaker-edit';
    input.value = span.textContent.replace(/:\s*$/, '').trim();
    input.style.minWidth = '40px';
    input.style.fontWeight = 'bold';

    // replace span with input and focus
    span.replaceWith(input);
    input.focus();
    input.select();

    // prevent double-commit from multiple events (keydown + blur)
    let committed = false;

    function commit(confirmed) {
        if (committed) return;
        committed = true;

        const newName = (input.value || '').trim();
        const newSpan = document.createElement('span');
        newSpan.className = 'speaker';
        newSpan.dataset.speakerKey = speakerKey;
        newSpan.dataset.utteranceIndex = String(utterIdx);

        if (confirmed && newName && newName !== span.textContent.replace(/:\s*$/, '').trim()) {
            if (!speakerRenames[speakerKey]) speakerRenames[speakerKey] = [];
            speakerRenames[speakerKey].push({ from: utterIdx, name: newName });
            speakerRenames[speakerKey].sort((a, b) => a.from - b.from);

            newSpan.textContent = newName + ': ';

            // Update existing speaker spans from this index onward
            const allSpans = document.querySelectorAll('#transcript .speaker');
            allSpans.forEach(s => {
                if (s.dataset.speakerKey === speakerKey) {
                    const idx = parseInt(s.dataset.utteranceIndex || '0', 10);
                    if (idx >= utterIdx) {
                        s.textContent = newName + ': ';
                    }
                }
            });
        } else {
            const display = getDisplayName(speakerKey, utterIdx);
            newSpan.textContent = display + ': ';
        }

        // Safely replace the input only if it's still in the DOM; otherwise try a sensible fallback
        try {
            if (input.isConnected) {
                input.replaceWith(newSpan);
            } else {
                // try to find the original location to replace, else append
                const selector = `#transcript .speaker[data-speaker-key="${CSS.escape(speakerKey)}"][data-utterance-index="${utterIdx}"]`;
                const existing = document.querySelector(selector);
                if (existing && existing.isConnected) existing.replaceWith(newSpan);
                else document.getElementById('transcript').appendChild(newSpan);
            }
        } catch (err) {
            console.warn('Safe replace failed:', err);
            if (!newSpan.isConnected) document.getElementById('transcript').appendChild(newSpan);
        }
    }

    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') commit(true);
        else if (e.key === 'Escape') commit(false);
    });
    input.addEventListener('blur', function () {
        commit(true);
    });
});

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
