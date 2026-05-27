class PCMProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.chunkSize = 3200; // default, can be overridden via port
        this.buffer = new Int16Array(0);
        this.enabled = true;

        this.port.onmessage = (e) => {
            const d = e.data;
            if (!d) return;
            if (d.type === 'config' && d.chunkSize) {
                this.chunkSize = d.chunkSize | 0;
            } else if (d.type === 'enabled') {
                this.enabled = !!d.enabled;
            }
        };
    }

    process(inputs) {
        if (!this.enabled) return true;

        const input = inputs[0];
        if (!input || !input[0]) return true;
        const float32 = input[0];
        const n = float32.length;

        // convert float32 -> int16
        const tmp = new Int16Array(n);
        for (let i = 0; i < n; i++) {
            let s = float32[i];
            if (s > 1) s = 1;
            else if (s < -1) s = -1;
            // prefer symmetric conversion
            tmp[i] = s < 0 ? Math.max(-32768, Math.floor(s * 32768)) : Math.min(32767, Math.floor(s * 32767));
        }

        // append to internal buffer
        const newBuf = new Int16Array(this.buffer.length + tmp.length);
        newBuf.set(this.buffer, 0);
        newBuf.set(tmp, this.buffer.length);
        this.buffer = newBuf;

        // emit full chunks
        while (this.buffer.length >= this.chunkSize) {
            const chunk = this.buffer.slice(0, this.chunkSize); // slice makes a copy
            // Transfer the underlying ArrayBuffer to main thread
            this.port.postMessage({ type: 'chunk', buffer: chunk.buffer }, [chunk.buffer]);

            // keep remainder
            this.buffer = this.buffer.slice(this.chunkSize);
        }

        return true;
    }
}

registerProcessor('pcm-processor', PCMProcessor);
