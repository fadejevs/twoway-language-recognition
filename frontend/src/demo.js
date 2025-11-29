/**
 * Two-Way Language Recognition Demo
 * Simple client-side implementation
 */

// Configuration - Update this to match your backend URL
const BACKEND_URL = 'http://localhost:5000';

let socket = null;
let mediaRecorder = null;
let audioContext = null;
let isRecording = false;
let recognitionActive = false;

// DOM elements
const statusEl = document.getElementById('status');
const connectBtn = document.getElementById('connectBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const sourceLangEl = document.getElementById('sourceLang');
const targetLangsEl = document.getElementById('targetLangs');
const roomIdEl = document.getElementById('roomId');
const transcriptionEl = document.getElementById('transcription');
const translationsEl = document.getElementById('translations');

// Connect to WebSocket server
connectBtn.addEventListener('click', () => {
    if (socket && socket.connected) {
        socket.disconnect();
        updateStatus(false);
        return;
    }
    
    socket = io(BACKEND_URL);
    
    socket.on('connect', () => {
        console.log('Connected to server');
        updateStatus(true);
        
        // Join room
        const roomId = roomIdEl.value || 'demo-room';
        socket.emit('join_room', { room: roomId });
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        updateStatus(false);
    });
    
    socket.on('connection_success', (data) => {
        console.log('Connection success:', data);
    });
    
    socket.on('room_joined', (data) => {
        console.log('Joined room:', data);
    });
    
    socket.on('realtime_recognition_started', (data) => {
        console.log('Recognition started:', data);
        recognitionActive = true;
        startBtn.disabled = true;
        stopBtn.disabled = false;
    });
    
    socket.on('realtime_recognition_stopped', (data) => {
        console.log('Recognition stopped:', data);
        recognitionActive = false;
        startBtn.disabled = false;
        stopBtn.disabled = true;
    });
    
    socket.on('realtime_transcription', (data) => {
        console.log('Transcription:', data);
        if (data.is_final) {
            transcriptionEl.innerHTML = `<strong>${data.text}</strong>`;
        } else {
            transcriptionEl.innerHTML = `${data.text} <em style="opacity:0.5">(listening...)</em>`;
        }
    });
    
    socket.on('realtime_translation', (data) => {
        console.log('Translation:', data);
        displayTranslations(data);
    });
    
    socket.on('translation_result', (data) => {
        console.log('Translation result:', data);
        displayTranslations(data);
    });
    
    socket.on('error', (data) => {
        console.error('Error:', data);
        alert('Error: ' + data.message);
    });
});

// Start real-time recognition
startBtn.addEventListener('click', async () => {
    if (!socket || !socket.connected) {
        alert('Please connect first');
        return;
    }
    
    try {
        // Request microphone access
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Create audio context
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(stream);
        
        // Create script processor for audio chunks
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        
        processor.onaudioprocess = (e) => {
            if (!recognitionActive) return;
            
            const inputData = e.inputBuffer.getChannelData(0);
            const pcmData = convertFloat32ToInt16(inputData);
            const base64Audio = arrayBufferToBase64(pcmData.buffer);
            
            // Send audio chunk
            socket.emit('realtime_audio_chunk', {
                room_id: roomIdEl.value || 'demo-room',
                audio_data: base64Audio
            });
        };
        
        source.connect(processor);
        processor.connect(audioContext.destination);
        
        // Start recognition on server
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
        
        isRecording = true;
        
    } catch (error) {
        console.error('Error starting recognition:', error);
        alert('Error accessing microphone: ' + error.message);
    }
});

// Stop recognition
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
    
    isRecording = false;
    recognitionActive = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
});

// Helper functions
function updateStatus(connected) {
    if (connected) {
        statusEl.className = 'status connected';
        statusEl.textContent = '✅ Connected';
        connectBtn.textContent = 'Disconnect';
        startBtn.disabled = false;
    } else {
        statusEl.className = 'status disconnected';
        statusEl.textContent = '⚠️ Disconnected';
        connectBtn.textContent = 'Connect';
        startBtn.disabled = true;
        stopBtn.disabled = true;
    }
}

function displayTranslations(data) {
    if (!data.translations || Object.keys(data.translations).length === 0) {
        translationsEl.innerHTML = '<em>No translations yet...</em>';
        return;
    }
    
    let html = '';
    for (const [lang, text] of Object.entries(data.translations)) {
        html += `
            <div class="translation-item">
                <div class="lang">${lang}</div>
                <div class="text">${text}</div>
            </div>
        `;
    }
    
    translationsEl.innerHTML = html;
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

