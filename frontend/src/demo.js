const BACKEND_URL = 'http://localhost:3000';

let socket = null;
let audioContext = null;
let recognitionActive = false;

const statusEl = document.getElementById('status');
const connectBtn = document.getElementById('connectBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const sourceLangEl = document.getElementById('sourceLang');
const targetLangsEl = document.getElementById('targetLangs');
const roomIdEl = document.getElementById('roomId');
const transcriptionEl = document.getElementById('transcription');
const translationsEl = document.getElementById('translations');

connectBtn.addEventListener('click', () => {
    if (socket && socket.connected) {
        socket.disconnect();
        updateStatus(false);
        return;
    }
    
    socket = io(BACKEND_URL);
    
    socket.on('connect', () => {
        updateStatus(true);
        const roomId = roomIdEl.value || 'demo-room';
        socket.emit('join_room', { room: roomId });
    });
    
    socket.on('disconnect', () => {
        updateStatus(false);
    });
    
    socket.on('realtime_recognition_started', () => {
        recognitionActive = true;
        startBtn.disabled = true;
        stopBtn.disabled = false;
    });
    
    socket.on('realtime_recognition_stopped', () => {
        recognitionActive = false;
        startBtn.disabled = false;
        stopBtn.disabled = true;
    });
    
    socket.on('realtime_transcription', (data) => {
        transcriptionEl.textContent = data.text;
    });
    
    socket.on('realtime_translation', (data) => {
        displayTranslations(data);
    });
    
    socket.on('error', (data) => {
        console.error('Error:', data);
    });
});

startBtn.addEventListener('click', async () => {
    if (!socket || !socket.connected) {
        alert('Please connect first');
        return;
    }
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        
        processor.onaudioprocess = (e) => {
            if (!recognitionActive) return;
            const inputData = e.inputBuffer.getChannelData(0);
            const pcmData = convertFloat32ToInt16(inputData);
            const base64Audio = arrayBufferToBase64(pcmData.buffer);
            
            socket.emit('realtime_audio_chunk', {
                room_id: roomIdEl.value || 'demo-room',
                audio_data: base64Audio
            });
        };
        
        source.connect(processor);
        processor.connect(audioContext.destination);
        
        const sourceLang = sourceLangEl.value;
        const targetLangs = targetLangsEl.value
            .split(',')
            .map(lang => lang.trim())
            .filter(lang => lang);
        
        socket.emit('start_realtime_recognition', {
            room_id: roomIdEl.value || 'demo-room',
            language: sourceLang,
            target_languages: targetLangs
        });
    } catch (error) {
        console.error('Error:', error);
        alert('Error accessing microphone: ' + error.message);
    }
});

stopBtn.addEventListener('click', () => {
    if (socket && socket.connected) {
        socket.emit('stop_realtime_recognition', {
            room_id: roomIdEl.value || 'demo-room'
        });
    }
    
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    
    recognitionActive = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
});

function updateStatus(connected) {
    if (connected) {
        statusEl.textContent = 'Connected';
        connectBtn.textContent = 'Disconnect';
        startBtn.disabled = false;
    } else {
        statusEl.textContent = 'Disconnected';
        connectBtn.textContent = 'Connect';
        startBtn.disabled = true;
        stopBtn.disabled = true;
    }
}

function displayTranslations(data) {
    if (!data.translations || Object.keys(data.translations).length === 0) {
        translationsEl.textContent = '-';
        return;
    }
    
    let text = '';
    for (const [lang, translation] of Object.entries(data.translations)) {
        text += `${lang}: ${translation}\n`;
    }
    translationsEl.textContent = text;
}

function convertFloat32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
