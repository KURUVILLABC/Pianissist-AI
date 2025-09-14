const NOTE_SEQUENCE = [
    { note: 'C',  isBlack: false },
    { note: 'C#', isBlack: true  },
    { note: 'D',  isBlack: false },
    { note: 'D#', isBlack: true  },
    { note: 'E',  isBlack: false },
    { note: 'F',  isBlack: false },
    { note: 'F#', isBlack: true  },
    { note: 'G',  isBlack: false },
    { note: 'G#', isBlack: true  },
    { note: 'A',  isBlack: false },
    { note: 'A#', isBlack: true  },
    { note: 'B',  isBlack: false }
];

const OCTAVES = [3, 4, 5];
const KEYBOARD_MAP = [
    // Lower octave
    'Z','S','X','D','C','V','G','B','H','N','J','M',
    // Middle octave
    'Q','2','W','3','E','R','5','T','6','Y','7','U','I',
    // Upper octave
    '1','!','4','$','8','9','0','=','-','[',']','\\'
];

// Generate frequencies for all keys in the desired range
function getNoteFrequencies(octaves) {
    const baseFreq = 440; // A4
    const notes = {};
    for (let octave of octaves) {
        for (let i = 0; i < NOTE_SEQUENCE.length; i++) {
            // Transpose down by 4 semitones
            const n = i + (octave - 4) * 12 - 4;
            const freq = baseFreq * Math.pow(2, n / 12);
            const noteName = NOTE_SEQUENCE[i].note + octave;
            notes[noteName] = parseFloat(freq.toFixed(2));
        }
    }
    return notes;
}
const NOTE_FREQUENCIES = getNoteFrequencies(OCTAVES);

function createPianoKeys() {
    const piano = document.querySelector('.piano');
    piano.innerHTML = '';

    const whiteKeys = [];
    const blackKeys = [];
    const keyDomOrder = [];
    let keyboardMapIndex = 0;

    OCTAVES.forEach(octave => {
        NOTE_SEQUENCE.forEach(({ note, isBlack }, i) => {
            const noteName = note + octave;
            const label = KEYBOARD_MAP[keyboardMapIndex] || '';
            if (!isBlack) {
                whiteKeys.push({ noteName, label, octave, keyboardMapIndex });
            } else {
                blackKeys.push({ noteName, label, octave, idx: whiteKeys.length - 1, keyboardMapIndex });
            }
            keyboardMapIndex++;
        });
    });

    // Render white keys
    whiteKeys.forEach(({ noteName, label, keyboardMapIndex }) => {
        const keyDiv = document.createElement('div');
        keyDiv.className = 'white-key';
        keyDiv.dataset.note = noteName;
        if (label) {
            const labelSpan = document.createElement('span');
            labelSpan.className = 'key-label';
            labelSpan.textContent = label;
            keyDiv.appendChild(labelSpan);
        }
        document.querySelector('.piano').appendChild(keyDiv);
        keyDomOrder[keyboardMapIndex] = keyDiv;
    });

    // Render black keys
    const whiteKeyWidth = 60;
    blackKeys.forEach(({ noteName, label, idx, keyboardMapIndex }) => {
        const keyDiv = document.createElement('div');
        keyDiv.className = 'black-key';
        keyDiv.dataset.note = noteName;
        keyDiv.style.left = `${(idx + 1) * whiteKeyWidth - 20}px`;
        if (label) {
            const labelSpan = document.createElement('span');
            labelSpan.className = 'key-label';
            labelSpan.textContent = label;
            keyDiv.appendChild(labelSpan);
        }
        document.querySelector('.piano').appendChild(keyDiv);
        keyDomOrder[keyboardMapIndex] = keyDiv;
    });

    document.querySelector('.piano').style.position = 'relative';
    document.querySelector('.piano').style.width = `${whiteKeys.length * whiteKeyWidth}px`;

    return keyDomOrder;
}

const keyDomOrder = createPianoKeys();

// --- Sound and interaction logic ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playNote(note) {
    const freq = NOTE_FREQUENCIES[note];
    if (!freq) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    osc.start();
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5);
    osc.stop(audioCtx.currentTime + 0.5);
}

function addKeyListeners() {
    keyDomOrder.forEach(key => {
        if (!key) return;
        key.addEventListener('mousedown', () => {
            playNote(key.dataset.note);
            key.classList.add('active');
        });
        key.addEventListener('mouseup', () => key.classList.remove('active'));
        key.addEventListener('mouseleave', () => key.classList.remove('active'));
    });

    document.addEventListener('keydown', e => {
        const idx = KEYBOARD_MAP.indexOf(e.key.toUpperCase());
        if (idx !== -1 && keyDomOrder[idx]) {
            const keyElem = keyDomOrder[idx];
            if (!keyElem.classList.contains('active')) {
                playNote(keyElem.dataset.note);
                keyElem.classList.add('active');
            }
        }
    });

    document.addEventListener('keyup', e => {
        const idx = KEYBOARD_MAP.indexOf(e.key.toUpperCase());
        if (idx !== -1 && keyDomOrder[idx]) {
            keyDomOrder[idx].classList.remove('active');
        }
    });
}
addKeyListeners();

// --- Optional: Microphone pitch-to-key mapping (bandpass filter, no AI/ML) ---
let micStream = null;
let micAnalyser = null;
let micSource = null;
let micListening = false;
let micAnimationId = null;
let currentMicNote = null;
let currentOsc = null;
let audioCtxMic = null;

const micBtn = document.getElementById('mic-btn');

micBtn.addEventListener('click', async () => {
    if (!micListening) {
        micBtn.textContent = '🛑 Stop Listening';
        await startMic();
    } else {
        micBtn.textContent = '🎤 Start Listening';
        stopMic();
    }
    micListening = !micListening;
});

async function startMic() {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtxMic = new (window.AudioContext || window.webkitAudioContext)();
    micSource = audioCtxMic.createMediaStreamSource(micStream);

    // Bandpass filter to focus on vocal range
    const bandpass = audioCtxMic.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = 300;
    bandpass.Q.value = 1.5;
    micSource.connect(bandpass);

    micAnalyser = audioCtxMic.createAnalyser();
    micAnalyser.fftSize = 2048;
    bandpass.connect(micAnalyser);

    const bufferLength = micAnalyser.fftSize;
    const buffer = new Float32Array(bufferLength);

    function detectPitch() {
        micAnalyser.getFloatTimeDomainData(buffer);
        const freq = autoCorrelate(buffer, audioCtxMic.sampleRate);
        if (freq !== -1) {
            const note = findClosestNote(freq);
            if (note) {
                playSustainedNote(note);
            } else {
                stopSustainedNote();
            }
        } else {
            stopSustainedNote();
        }
        micAnimationId = requestAnimationFrame(detectPitch);
    }
    detectPitch();
}

function stopMic() {
    if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
    }
    if (micAnimationId) {
        cancelAnimationFrame(micAnimationId);
        micAnimationId = null;
    }
    stopSustainedNote();
    if (audioCtxMic) {
        audioCtxMic.close();
        audioCtxMic = null;
    }
}

// --- Pitch detection (autocorrelation) ---
function autoCorrelate(buffer, sampleRate) {
    let SIZE = buffer.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) {
        let val = buffer[i];
        rms += val * val;
    }
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) // too quiet
        return -1;

    let r1 = 0, r2 = SIZE - 1, thres = 0.2;
    for (let i = 0; i < SIZE / 2; i++) {
        if (Math.abs(buffer[i]) < thres) { r1 = i; break; }
    }
    for (let i = 1; i < SIZE / 2; i++) {
        if (Math.abs(buffer[SIZE - i]) < thres) { r2 = SIZE - i; break; }
    }

    buffer = buffer.slice(r1, r2);
    SIZE = buffer.length;

    let c = new Array(SIZE).fill(0);
    for (let i = 0; i < SIZE; i++) {
        for (let j = 0; j < SIZE - i; j++) {
            c[i] = c[i] + buffer[j] * buffer[j + i];
        }
    }
    let d = 0; while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < SIZE; i++) {
        if (c[i] > maxval) {
            maxval = c[i];
            maxpos = i;
        }
    }
    let T0 = maxpos;
    if (T0 === 0) return -1;
    return sampleRate / T0;
}

// --- Find the closest note name for a given frequency ---
function findClosestNote(freq) {
    let minDiff = Infinity;
    let closestNote = null;
    for (const note in NOTE_FREQUENCIES) {
        const diff = Math.abs(NOTE_FREQUENCIES[note] - freq);
        if (diff < minDiff) {
            minDiff = diff;
            closestNote = note;
        }
    }
    // Only return if within a reasonable range (e.g., 30Hz)
    if (minDiff < 30) return closestNote;
    return null;
}

// --- Sustain logic for mic input ---
function playSustainedNote(note) {
    if (currentMicNote === note) return; // Already playing this note

    stopSustainedNote();

    const freq = NOTE_FREQUENCIES[note];
    if (!freq) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    osc.start();

    currentOsc = { osc, gain };
    currentMicNote = note;

    // Highlight key
    document.querySelectorAll('.white-key, .black-key').forEach(key => {
        if (key.dataset.note === note) {
            key.classList.add('active');
        } else {
            key.classList.remove('active');
        }
    });
}

function stopSustainedNote() {
    if (currentOsc) {
        currentOsc.gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.1);
        currentOsc.osc.stop(audioCtx.currentTime + 0.1);
        currentOsc = null;
    }
    currentMicNote = null;
    // Remove highlight
    document.querySelectorAll('.white-key, .black-key').forEach(key => {
        key.classList.remove('active');
    });
}

let mediaRecorder, recordedChunks = [], recordedAudioBuffer = null;

const recordBtn = document.getElementById('record-btn');
const playRecordingBtn = document.getElementById('play-recording-btn');
const playNotesBtn = document.getElementById('play-notes-btn');

recordBtn.onclick = () => {
    alert('Record button clicked!');
};
playRecordingBtn.onclick = () => {
    alert('Play recording clicked!');
};
playNotesBtn.onclick = () => {
    alert('Play notes clicked!');
};