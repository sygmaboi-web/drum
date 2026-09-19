// --- 1. CONFIGURATION & STATE ---
const pieces = ['kick', 'snare', 'hihatClosed', 'hihatOpen', 'tomHigh', 'tomMid', 'tomFloor', 'crash', 'ride'];

// Struktur File Audio Masa Depan (Mendukung .flac untuk hi-res audio, atau .wav)
const audioFiles = {
    kick: ['audio/kick-1.flac', 'audio/kick-2.flac', 'audio/kick-3.flac', 'audio/kick-4.flac', 'audio/kick-5.flac'],
    snare: ['audio/snare-1.flac', 'audio/snare-2.flac', 'audio/snare-3.flac', 'audio/snare-4.flac', 'audio/snare-5.flac'],
    hihatClosed: ['audio/hhc-1.flac', 'audio/hhc-2.flac', 'audio/hhc-3.flac', 'audio/hhc-4.flac', 'audio/hhc-5.flac'],
    hihatOpen: ['audio/hho-1.flac', 'audio/hho-2.flac', 'audio/hho-3.flac', 'audio/hho-4.flac', 'audio/hho-5.flac'],
    tomHigh: ['audio/tomh-1.flac', 'audio/tomh-2.flac', 'audio/tomh-3.flac', 'audio/tomh-4.flac', 'audio/tomh-5.flac'],
    tomMid: ['audio/tomm-1.flac', 'audio/tomm-2.flac', 'audio/tomm-3.flac', 'audio/tomm-4.flac', 'audio/tomm-5.flac'],
    tomFloor: ['audio/tomf-1.flac', 'audio/tomf-2.flac', 'audio/tomf-3.flac', 'audio/tomf-4.flac', 'audio/tomf-5.flac'],
    crash: ['audio/crash-1.flac', 'audio/crash-2.flac', 'audio/crash-3.flac', 'audio/crash-4.flac', 'audio/crash-5.flac'],
    ride: ['audio/ride-1.flac', 'audio/ride-2.flac', 'audio/ride-3.flac', 'audio/ride-4.flac', 'audio/ride-5.flac']
};

const keyMap = {
    'Space': 'kick', 'KeyS': 'snare', 'KeyE': 'hihatClosed', 'KeyW': 'hihatOpen',
    'KeyH': 'tomHigh', 'KeyJ': 'tomMid', 'KeyK': 'tomFloor', 'KeyY': 'crash', 'KeyU': 'ride'
};

// MIDI Map standar
const midiMap = { 36: 'kick', 38: 'snare', 42: 'hihatClosed', 46: 'hihatOpen', 50: 'tomHigh', 48: 'tomMid', 43: 'tomFloor', 49: 'crash', 51: 'ride' };

let audioCtx, masterGain, convolver;
let pieceNodes = {}; // Menyimpan node Gain dan Panner individual
let currentVariations = {}; // Menyimpan variasi terpilih (1-5) per instrumen
let isRecording = false;
let mediaRecorder, recordedChunks = [];
let audioDestination; // Untuk recorder stream

// --- 2. AUDIO ENGINE & SYNTHESIS FALLBACK ---
// Inisialisasi AudioContext saat ada interaksi user pertama kali (kebijakan browser)
function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.8;

    convolver = audioCtx.createConvolver();
    createReverbImpulse(); // Buat IR Reverb secara sintetik

    audioDestination = audioCtx.createMediaStreamDestination();
    
    // Routing: Reverb -> Master -> Out/Record
    convolver.connect(masterGain);
    masterGain.connect(audioCtx.destination);
    masterGain.connect(audioDestination); 

    // Setup channel per piece
    pieces.forEach(p => {
        currentVariations[p] = 1; // Default variasi 1
        let gainNode = audioCtx.createGain();
        let panner = audioCtx.createStereoPanner();
        panner.connect(gainNode);
        
        // Default routing by bypass reverb
        gainNode.connect(masterGain);
        
        pieceNodes[p] = { gain: gainNode, panner: panner };
        
        // Set default pan (Hihat kiri, Ride kanan, dll)
        if(p.includes('hihat')) panner.pan.value = -0.5;
        if(p === 'ride') panner.pan.value = 0.5;
        if(p === 'tomHigh') panner.pan.value = -0.3;
        if(p === 'tomFloor') panner.pan.value = 0.4;
    });

    setupUI(); // Buat UI Mixer setelah Node audio siap
}

// Reverb Impulse Response Generator sederhana
function createReverbImpulse() {
    let rate = audioCtx.sampleRate, length = rate * 2;
    let impulse = audioCtx.createBuffer(2, length, rate);
    let left = impulse.getChannelData(0), right = impulse.getChannelData(1);
    for (let i = 0; i < length; i++) {
        let decay = Math.exp(-i / (rate * 0.5)); // Waktu decay
        left[i] = (Math.random() * 2 - 1) * decay;
        right[i] = (Math.random() * 2 - 1) * decay;
    }
    convolver.buffer = impulse;
}

// Fallback Sintesis Audio Real-time (Sangat berguna sebelum me-load file lokal)
// Menghasilkan bunyi berdasarkan instrumen dan variasi (1-5)
function playSynth(piece, variation, time, velocity = 1) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(pieceNodes[piece].panner);
    
    const v = variation; // 1 to 5
    gain.gain.setValueAtTime(0, time);

    if (piece === 'kick') {
        // Parametrik Kick: variasi mengubah pitch drop dan attack
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150 + (v*10), time);
        osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.5);
        gain.gain.linearRampToValueAtTime(velocity, time + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.01, time + (0.4 + v*0.05));
        osc.start(time); osc.stop(time + 1);
    } 
    else if (piece === 'snare') {
        // Snare = Triangle (body) + Noise (wire)
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(200 + (v*20), time);
        gain.gain.linearRampToValueAtTime(velocity, time + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
        osc.start(time); osc.stop(time + 0.2);

        // Noise untuk snare wire
        const noise = createNoiseBuffer();
        const noiseSource = audioCtx.createBufferSource();
        noiseSource.buffer = noise;
        const noiseFilter = audioCtx.createBiquadFilter();
        noiseFilter.type = 'highpass';
        noiseFilter.frequency.value = 1000 + (v*100);
        const noiseGain = audioCtx.createGain();
        noiseGain.gain.setValueAtTime(velocity, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, time + (0.2 + v*0.02));
        noiseSource.connect(noiseFilter).connect(noiseGain).connect(pieceNodes[piece].panner);
        noiseSource.start(time); noiseSource.stop(time + 0.5);
    }
    else if (piece.includes('tom')) {
        let baseFreq = piece === 'tomHigh' ? 250 : piece === 'tomMid' ? 180 : 100;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(baseFreq + (v*15), time);
        osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.8);
        gain.gain.linearRampToValueAtTime(velocity, time + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.01, time + (0.4 + v*0.1));
        osc.start(time); osc.stop(time + 1);
    }
    else if (piece.includes('hihat') || piece === 'crash' || piece === 'ride') {
        // Metallic/Cymbal synthesis berbasis noise filtering
        const noise = createNoiseBuffer();
        const noiseSrc = audioCtx.createBufferSource();
        noiseSrc.buffer = noise;
        
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        
        let decayTime;
        if(piece === 'hihatClosed') { filter.frequency.value = 8000 + (v*200); decayTime = 0.1 + (v*0.01); }
        else if(piece === 'hihatOpen') { filter.frequency.value = 7500 + (v*150); decayTime = 0.4 + (v*0.05); }
        else if(piece === 'crash') { filter.frequency.value = 4000 + (v*300); decayTime = 1.5 + (v*0.2); }
        else if(piece === 'ride') { filter.frequency.value = 5500 + (v*200); decayTime = 1.2 + (v*0.1); }

        gain.gain.setValueAtTime(velocity, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + decayTime);
        noiseSrc.connect(filter).connect(gain);
        noiseSrc.start(time); noiseSrc.stop(time + decayTime * 2);
    }
}

function createNoiseBuffer() {
    const bufferSize = audioCtx.sampleRate * 2; // 2 seconds
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    return buffer;
}

// Fungsi Trigger Audio Master
function triggerDrum(piece, velocity = 1) {
    if (!audioCtx) initAudio();
    const time = audioCtx.currentTime;
    const variation = currentVariations[piece];
    
    // Fallback ke synth. Jika Anda sudah implementasi Fetch URL Audio Buffer, tambahkan logika mainkan buffer di sini.
    playSynth(piece, variation, time, velocity);
    
    // Visual Feedback
    const el = document.querySelector(`.drum-piece[data-piece="${piece}"]`);
    if(el) {
        el.classList.add('hit');
        setTimeout(() => el.classList.remove('hit'), 100);
    }
}

// --- 3. UI, MIXER & DRAG/DROP LOGIC ---
function setupUI() {
    const mixerCont = document.getElementById('mixer-controls');
    pieces.forEach(p => {
        const strip = document.createElement('div');
        strip.className = 'channel-strip';
        strip.innerHTML = `
            <strong>${p}</strong>
            <select data-piece="${p}">
                <option value="1">Var 1</option><option value="2">Var 2</option>
                <option value="3">Var 3</option><option value="4">Var 4</option>
                <option value="5">Var 5</option>
            </select>
            <label>Vol</label>
            <input type="range" class="vol-slider" data-piece="${p}" min="0" max="2" step="0.1" value="1">
            <label>Pan</label>
            <input type="range" class="pan-slider" data-piece="${p}" min="-1" max="1" step="0.1" value="${pieceNodes[p].panner.pan.value}">
        `;
        mixerCont.appendChild(strip);
    });

    // Event Listeners for Mixer
    mixerCont.addEventListener('change', (e) => {
        if(e.target.tagName === 'SELECT') {
            currentVariations[e.target.dataset.piece] = parseInt(e.target.value);
        }
    });
    mixerCont.addEventListener('input', (e) => {
        const piece = e.target.dataset.piece;
        if(e.target.classList.contains('vol-slider')) {
            pieceNodes[piece].gain.gain.value = parseFloat(e.target.value);
        } else if(e.target.classList.contains('pan-slider')) {
            pieceNodes[piece].panner.pan.value = parseFloat(e.target.value);
        }
    });
}

// Master Controls
document.getElementById('master-vol').addEventListener('input', (e) => {
    if(masterGain) masterGain.gain.value = parseFloat(e.target.value);
});
document.getElementById('master-reverb').addEventListener('change', (e) => {
    if(!audioCtx) return;
    pieces.forEach(p => {
        pieceNodes[p].gain.disconnect();
        if(e.target.checked) pieceNodes[p].gain.connect(convolver);
        else pieceNodes[p].gain.connect(masterGain);
    });
});

// Drag and Drop Logic untuk Modifikasi Layout Posisi Kit
document.querySelectorAll('.drum-piece').forEach(piece => {
    piece.addEventListener('mousedown', (e) => {
        let offsetX = e.clientX - piece.getBoundingClientRect().left;
        let offsetY = e.clientY - piece.getBoundingClientRect().top;
        
        function moveAt(pageX, pageY) {
            piece.style.left = pageX - offsetX + 'px';
            piece.style.top = pageY - offsetY + 'px';
        }
        function onMouseMove(event) { moveAt(event.pageX, event.pageY); }
        
        document.addEventListener('mousemove', onMouseMove);
        piece.onmouseup = function() {
            document.removeEventListener('mousemove', onMouseMove);
            piece.onmouseup = null;
        };
    });
    piece.ondragstart = () => false;
});


// --- 4. GESTURE DETECTION (MEDIAPIPE) ---
const videoElement = document.getElementById('webcam-video');
const canvasElement = document.getElementById('gesture-canvas');
const canvasCtx = canvasElement.getContext('2d');
let hitCooldown = {}; // Menghindari multiple trigger instan

const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 2, modelComplexity: 1,
    minDetectionConfidence: 0.6, minTrackingConfidence: 0.6
});

hands.onResults((results) => {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    // Fit canvas to video
    if(canvasElement.width !== videoElement.videoWidth) {
        canvasElement.width = window.innerWidth;
        canvasElement.height = window.innerHeight;
    }

    if (results.multiHandLandmarks) {
        for (const landmarks of results.multiHandLandmarks) {
            // Gambar landmarks tangan tipis untuk debugin
            drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {color: '#00ffcc', lineWidth: 1});
            
            // Logika Hitbox: Gunakan ujung jari telunjuk (Index Finger Tip - Index 8)
            const indexTip = landmarks[8]; 
            
            // Koordinat layar (Ingat layar di-mirror)
            const x = (1 - indexTip.x) * window.innerWidth; 
            const y = indexTip.y * window.innerHeight;

            checkHitboxCollision(x, y);
        }
    }
    canvasCtx.restore();
});

function checkHitboxCollision(x, y) {
    const timeNow = Date.now();
    document.querySelectorAll('.drum-piece').forEach(pieceEl => {
        const rect = pieceEl.getBoundingClientRect();
        const pieceId = pieceEl.dataset.piece;
        
        // Cek jika jari ada di dalam kotak div drum
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            // Cooldown 150ms per instrumen untuk mencegah suara 'brrrrr'
            if (!hitCooldown[pieceId] || (timeNow - hitCooldown[pieceId] > 150)) {
                triggerDrum(pieceId, 0.8); // Trigger via webcam
                hitCooldown[pieceId] = timeNow;
            }
        }
    });
}

// Start Kamera
const camera = new Camera(videoElement, {
    onFrame: async () => { await hands.send({image: videoElement}); },
    width: 640, height: 480
});
camera.start();


// --- 5. INPUT LANJUTAN (KEYBOARD & MIDI) ---
// Keyboard Listener
window.addEventListener('keydown', (e) => {
    if(e.repeat) return; // Cegah auto-repeat saat tombol ditahan
    const code = e.code;
    if(keyMap[code]) {
        initAudio();
        triggerDrum(keyMap[code]);
    }
});

// Web MIDI API Integration
// Cocok untuk di-trigger oleh modul eksternal (misal sensor piezo + modul ESP32/Arduino via serial-to-MIDI)
if (navigator.requestMIDIAccess) {
    navigator.requestMIDIAccess().then(onMIDISuccess, onMIDIFailure);
}

function onMIDISuccess(midiAccess) {
    document.getElementById('midi-status').textContent = 'MIDI: Connected';
    document.getElementById('midi-status').classList.add('connected');
    for (var input of midiAccess.inputs.values()) {
        input.onmidimessage = getMIDIMessage;
    }
}
function onMIDIFailure() {
    console.warn("Browser tidak mendukung atau memblokir akses MIDI.");
}
function getMIDIMessage(message) {
    const command = message.data[0];
    const note = message.data[1];
    const velocity = (message.data.length > 2) ? message.data[2] : 0;
    
    // Note On (command 144) dengan velocity > 0
    if (command === 144 && velocity > 0) {
        if(midiMap[note]) {
            initAudio();
            triggerDrum(midiMap[note], velocity / 127); // Normalize velocity 0-1
        }
    }
}


// --- 6. METRONOME & RECORDING ---
// Metronome Logic
let metroInterval;
let isMetroPlaying = false;
document.getElementById('metro-toggle').addEventListener('click', (e) => {
    initAudio();
    isMetroPlaying = !isMetroPlaying;
    e.target.textContent = isMetroPlaying ? 'Stop' : 'Play';
    
    if(isMetroPlaying) {
        const bpm = document.getElementById('bpm-input').value;
        const intervalMs = (60 / bpm) * 1000;
        metroInterval = setInterval(() => {
            playSynth('hihatClosed', 5, audioCtx.currentTime, 0.5); // Klik metronome
        }, intervalMs);
    } else {
        clearInterval(metroInterval);
    }
});

// Recording Logic via MediaRecorder API
document.getElementById('record-btn').addEventListener('click', (e) => {
    initAudio();
    if(!isRecording) {
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(audioDestination.stream);
        mediaRecorder.ondataavailable = e => { if(e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'audio/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.getElementById('download-link');
            a.href = url;
            a.download = 'drum-jam.webm';
            a.style.display = 'inline';
        };
        mediaRecorder.start();
        isRecording = true;
        e.target.textContent = 'Stop & Save';
        e.target.style.background = '#ff5555';
    } else {
        mediaRecorder.stop();
        isRecording = false;
        e.target.textContent = 'Start Record';
        e.target.style.background = '#333';
    }
});
