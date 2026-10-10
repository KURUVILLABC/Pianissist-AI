'use strict';

const FIRST_MIDI = 36;
const LAST_MIDI = 83;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const WHITE_NOTES = new Set([0, 2, 4, 5, 7, 9, 11]);
const WHITE_KEY_WIDTH = 43;
const MAX_DETECTED_NOTES = 6;

const micButton = document.getElementById('mic-btn');
const micLabel = document.getElementById('mic-label');
const monitorToggle = document.getElementById('monitor-toggle');
const status = document.getElementById('status');
const statusText = document.getElementById('status-text');
const detectedNotes = document.getElementById('detected-notes');
const detectorHint = document.getElementById('detector-hint');
const levelBar = document.getElementById('level-bar');
const performancePanel = document.getElementById('performance-panel');
const performanceSummary = document.getElementById('performance-summary');
const replayButton = document.getElementById('replay-btn');
const replayLabel = document.getElementById('replay-label');
const piano = document.querySelector('.piano');
const keyboardKeys = new Map();
const manualVoices = new Map();
const monitorVoices = new Map();
const replayVoices = new Set();

let microphoneStream = null;
let microphoneContext = null;
let microphoneAnalyser = null;
let microphoneFrame = 0;
let synthContext = null;
let listening = false;
let noteHistory = [];
let activeDetectedNotes = new Set();
let lastAnalysisTime = 0;
let recordingStartedAt = 0;
let recordedSegments = [];
let openRecordedNotes = new Map();
let replayFrame = 0;
let replaying = false;
let replayStartedAt = 0;
let replayHighlightedNotes = new Set();

function midiToNote(midi) {
    return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function midiToFrequency(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

function createKeyboard() {
    let whiteKeyIndex = 0;

    for (let midi = FIRST_MIDI; midi <= LAST_MIDI; midi += 1) {
        const pitchClass = midi % 12;
        const key = document.createElement('button');
        const isWhite = WHITE_NOTES.has(pitchClass);
        const note = midiToNote(midi);

        key.type = 'button';
        key.className = isWhite ? 'white-key' : 'black-key';
        key.dataset.midi = String(midi);
        key.dataset.note = note;
        key.setAttribute('aria-label', `Play ${note}`);

        if (isWhite) {
            key.style.order = String(whiteKeyIndex * 2);
            whiteKeyIndex += 1;
        } else {
            key.style.left = `${whiteKeyIndex * WHITE_KEY_WIDTH - 14}px`;
            key.style.order = String(whiteKeyIndex * 2 - 1);
        }

        if (pitchClass === 0) {
            const label = document.createElement('span');
            label.className = 'key-note';
            label.textContent = note;
            key.appendChild(label);
        }

        key.addEventListener('pointerdown', event => {
            event.preventDefault();
            startManualNote(midi, key);
        });
        key.addEventListener('pointerup', () => stopManualNote(midi));
        key.addEventListener('pointercancel', () => stopManualNote(midi));
        key.addEventListener('pointerleave', event => {
            if (event.buttons === 0) stopManualNote(midi);
        });
        key.addEventListener('keydown', event => {
            if (event.repeat || (event.key !== ' ' && event.key !== 'Enter')) return;
            event.preventDefault();
            startManualNote(midi, key);
        });
        key.addEventListener('keyup', event => {
            if (event.key === ' ' || event.key === 'Enter') stopManualNote(midi);
        });

        piano.appendChild(key);
        keyboardKeys.set(midi, key);
    }

    piano.style.width = `${whiteKeyIndex * WHITE_KEY_WIDTH}px`;
}

function setStatus(message, state = '') {
    statusText.textContent = message;
    status.classList.toggle('is-listening', state === 'listening');
    status.classList.toggle('is-error', state === 'error');
}

function getSynthContext() {
    if (!synthContext || synthContext.state === 'closed') {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        synthContext = new AudioContextClass();
    }
    if (synthContext.state === 'suspended') synthContext.resume();
    return synthContext;
}

function startVoice(midi, volume = 0.12) {
    const context = getSynthContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = midiToFrequency(midi);
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(volume, context.currentTime + 0.025);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    return { oscillator, gain };
}

function stopVoice(voice) {
    if (!voice || !synthContext || synthContext.state === 'closed') return;
    const now = synthContext.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0, now, 0.035);
    voice.oscillator.stop(now + 0.15);
}

function startScheduledVoice(midi, startAt, endAt) {
    const context = getSynthContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    const noteStart = Math.max(startAt, now + 0.02);
    const noteEnd = Math.max(endAt, noteStart + 0.04);

    oscillator.type = 'triangle';
    oscillator.frequency.value = midiToFrequency(midi);
    gain.gain.setValueAtTime(0, now);
    gain.gain.setValueAtTime(0, noteStart);
    gain.gain.linearRampToValueAtTime(0.16, noteStart + 0.025);
    gain.gain.setTargetAtTime(0, noteEnd, 0.035);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteEnd + 0.15);

    return { oscillator, gain };
}

function startManualNote(midi, key) {
    if (manualVoices.has(midi)) return;
    manualVoices.set(midi, startVoice(midi, 0.16));
    key.classList.add('manual-active');
}

function stopManualNote(midi) {
    const voice = manualVoices.get(midi);
    if (!voice) return;
    stopVoice(voice);
    manualVoices.delete(midi);
    keyboardKeys.get(midi).classList.remove('manual-active');
}

function stopMonitorVoices() {
    for (const [midi, voice] of monitorVoices) {
        stopVoice(voice);
        monitorVoices.delete(midi);
    }
}

function updateMonitorVoices(notes) {
    if (!monitorToggle.checked || !listening) {
        stopMonitorVoices();
        return;
    }
    for (const [midi, voice] of monitorVoices) {
        if (!notes.has(midi)) {
            stopVoice(voice);
            monitorVoices.delete(midi);
        }
    }
    for (const midi of notes) {
        if (!monitorVoices.has(midi)) {
            monitorVoices.set(midi, startVoice(midi, 0.045));
        }
    }
}

function renderDetectedNotes(notes) {
    for (const midi of activeDetectedNotes) {
        if (!notes.has(midi)) keyboardKeys.get(midi).classList.remove('mic-active');
    }
    for (const midi of notes) keyboardKeys.get(midi).classList.add('mic-active');
    activeDetectedNotes = notes;

    const names = [...notes].sort((a, b) => a - b).map(midiToNote);
    detectedNotes.textContent = names.length ? names.join('  ·  ') : '—';
    detectorHint.textContent = names.length
        ? `${names.length} ${names.length === 1 ? 'note' : 'notes'} detected`
        : 'Listening for a clear musical pitch…';
    updateMonitorVoices(notes);
}

function updateRecordedNotes(notes, timestamp) {
    for (const [midi, startedAt] of openRecordedNotes) {
        if (!notes.has(midi)) {
            recordedSegments.push({ midi, start: startedAt, end: timestamp });
            openRecordedNotes.delete(midi);
        }
    }
    for (const midi of notes) {
        if (!openRecordedNotes.has(midi)) openRecordedNotes.set(midi, timestamp);
    }
    updatePerformanceSummary();
}

function getRecordedDuration() {
    let lastNoteEnd = 0;
    for (const segment of recordedSegments) lastNoteEnd = Math.max(lastNoteEnd, segment.end);
    for (const startedAt of openRecordedNotes.values()) {
        lastNoteEnd = Math.max(lastNoteEnd, performance.now() - recordingStartedAt);
    }
    return lastNoteEnd;
}

function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function updatePerformanceSummary() {
    const noteCount = recordedSegments.length + openRecordedNotes.size;
    performanceSummary.textContent = noteCount
        ? `${noteCount} detected ${noteCount === 1 ? 'note' : 'notes'} · ${formatDuration(getRecordedDuration())}`
        : listening ? 'Listening for notes to record…' : 'No notes were detected in this recording.';
}

function finalizeRecording() {
    const endedAt = performance.now() - recordingStartedAt;
    for (const [midi, startedAt] of openRecordedNotes) {
        recordedSegments.push({ midi, start: startedAt, end: endedAt });
    }
    openRecordedNotes.clear();
    recordedSegments = recordedSegments
        .filter(segment => segment.end - segment.start >= 45)
        .sort((a, b) => a.start - b.start);
    updatePerformanceSummary();
    replayButton.disabled = recordedSegments.length === 0;
    replayLabel.textContent = 'Replay recorded notes';
    replayButton.querySelector('[aria-hidden="true"]').textContent = '▶';
}

function stopReplay() {
    if (replayFrame) cancelAnimationFrame(replayFrame);
    replayFrame = 0;
    replaying = false;

    for (const voice of replayVoices) stopVoice(voice);
    replayVoices.clear();
    for (const midi of replayHighlightedNotes) {
        keyboardKeys.get(midi).classList.remove('replay-active');
    }
    replayHighlightedNotes.clear();

    replayButton.querySelector('[aria-hidden="true"]').textContent = '▶';
    replayLabel.textContent = 'Replay recorded notes';
}

function updateReplayHighlights(timestamp) {
    if (!replaying) return;
    const elapsed = timestamp - replayStartedAt;
    const currentNotes = new Set(
        recordedSegments
            .filter(segment => segment.start <= elapsed && segment.end > elapsed)
            .map(segment => segment.midi)
    );

    for (const midi of replayHighlightedNotes) {
        if (!currentNotes.has(midi)) keyboardKeys.get(midi).classList.remove('replay-active');
    }
    for (const midi of currentNotes) keyboardKeys.get(midi).classList.add('replay-active');
    replayHighlightedNotes = currentNotes;

    if (elapsed >= getRecordedDuration()) {
        stopReplay();
        return;
    }
    replayFrame = requestAnimationFrame(updateReplayHighlights);
}

async function replayRecording() {
    if (replaying) {
        stopReplay();
        return;
    }
    if (recordedSegments.length === 0) return;

    stopMonitorVoices();
    const context = getSynthContext();
    await context.resume();
    replaying = true;
    replayStartedAt = performance.now() + 80;
    const audioStart = context.currentTime + 0.08;

    for (const segment of recordedSegments) {
        const voice = startScheduledVoice(
            segment.midi,
            audioStart + segment.start / 1000,
            audioStart + segment.end / 1000
        );
        replayVoices.add(voice);
        window.setTimeout(() => replayVoices.delete(voice), segment.end + 250);
    }

    replayButton.querySelector('[aria-hidden="true"]').textContent = '■';
    replayLabel.textContent = 'Stop replay';
    replayFrame = requestAnimationFrame(updateReplayHighlights);
}

function getRms(buffer) {
    let sumSquares = 0;
    for (const value of buffer) sumSquares += value * value;
    return Math.sqrt(sumSquares / buffer.length);
}

function findSpectralPeaks(amplitudes, sampleRate, fftSize) {
    const peaks = [];
    const binWidth = sampleRate / fftSize;

    for (let bin = 2; bin < amplitudes.length - 2; bin += 1) {
        const left = amplitudes[bin - 1];
        const center = amplitudes[bin];
        const right = amplitudes[bin + 1];
        if (center < 0.025 || center <= left || center < right) continue;

        const leftDb = 20 * Math.log10(Math.max(left, 0.000001));
        const centerDb = 20 * Math.log10(center);
        const rightDb = 20 * Math.log10(Math.max(right, 0.000001));
        const denominator = leftDb - 2 * centerDb + rightDb;
        const offset = denominator === 0
            ? 0
            : Math.max(-0.5, Math.min(0.5, 0.5 * (leftDb - rightDb) / denominator));

        peaks.push({
            frequency: (bin + offset) * binWidth,
            amplitude: center
        });
    }

    return peaks;
}

function peakNearFrequency(peaks, frequency, tolerance) {
    let closestPeak = null;
    let closestDistance = Infinity;

    for (const peak of peaks) {
        const distance = Math.abs(peak.frequency - frequency);
        if (distance <= tolerance && distance < closestDistance) {
            closestPeak = peak;
            closestDistance = distance;
        }
    }

    return closestPeak;
}

function detectPolyphonicNotes(frequencyData, sampleRate, fftSize) {
    let peakDb = -Infinity;
    for (let index = 1; index < frequencyData.length; index += 1) {
        if (frequencyData[index] > peakDb) peakDb = frequencyData[index];
    }
    if (!Number.isFinite(peakDb) || peakDb < -78) return [];

    const amplitudes = new Float32Array(frequencyData.length);
    for (let index = 1; index < frequencyData.length; index += 1) {
        const db = frequencyData[index];
        amplitudes[index] = db < peakDb - 56 ? 0 : Math.pow(10, (db - peakDb) / 20);
    }

    const binWidth = sampleRate / fftSize;
    const peaks = findSpectralPeaks(amplitudes, sampleRate, fftSize);
    const candidates = [];
    let strongestFundamental = 0;
    for (let midi = FIRST_MIDI; midi <= LAST_MIDI; midi += 1) {
        const fundamental = midiToFrequency(midi);
        if (fundamental > sampleRate / 2) continue;
        let score = 0;
        let weightSum = 0;
        let harmonicSupport = 0;
        const fundamentalPeak = peakNearFrequency(peaks, fundamental, fundamental * 0.032);
        const fundamentalEnergy = fundamentalPeak ? fundamentalPeak.amplitude : 0;
        strongestFundamental = Math.max(strongestFundamental, fundamentalEnergy);
        const maxHarmonic = Math.min(8, Math.floor((sampleRate / 2) / fundamental));

        for (let harmonic = 1; harmonic <= maxHarmonic; harmonic += 1) {
            const weight = 1 / Math.sqrt(harmonic);
            const targetFrequency = fundamental * harmonic;
            const harmonicPeak = peakNearFrequency(
                peaks,
                targetFrequency,
                Math.max(binWidth * 1.5, targetFrequency * 0.008)
            );
            const energy = harmonicPeak ? harmonicPeak.amplitude : 0;
            if (energy > 0.14) harmonicSupport += 1;
            score += energy * weight;
            weightSum += weight;
        }

        score /= weightSum;
        if (score > 0.012) candidates.push({ midi, score, fundamentalEnergy, harmonicSupport });
    }

    candidates.sort((a, b) => b.score - a.score);
    if (!candidates.length) return [];

    const selected = [];
    const strongest = candidates[0].score;
    for (const candidate of candidates) {
        if (selected.length >= MAX_DETECTED_NOTES || candidate.score < strongest * 0.22) break;
        if (candidate.fundamentalEnergy < strongestFundamental * 0.09 && candidate.harmonicSupport < 3) continue;

        const explainedByHarmonic = selected.some(other => {
            const ratio = midiToFrequency(Math.max(candidate.midi, other.midi))
                / midiToFrequency(Math.min(candidate.midi, other.midi));
            const nearestHarmonic = Math.round(ratio);
            return nearestHarmonic >= 2
                && nearestHarmonic <= 8
                && Math.abs(ratio - nearestHarmonic) < 0.035
                && candidate.fundamentalEnergy < other.fundamentalEnergy * 0.62
                && candidate.score < other.score * 0.82;
        });

        if (!explainedByHarmonic) selected.push(candidate);
    }

    return selected.map(candidate => candidate.midi);
}

function updateLevel(rms) {
    const level = Math.min(100, Math.max(0, (20 * Math.log10(Math.max(rms, 0.00001)) + 65) * 1.65));
    levelBar.style.width = `${level}%`;
}

function analyzeAudio(timestamp) {
    if (!listening || !microphoneAnalyser || !microphoneContext) return;
    microphoneFrame = requestAnimationFrame(analyzeAudio);
    if (timestamp - lastAnalysisTime < 55) return;
    lastAnalysisTime = timestamp;

    const timeData = new Float32Array(microphoneAnalyser.fftSize);
    const frequencyData = new Float32Array(microphoneAnalyser.frequencyBinCount);
    microphoneAnalyser.getFloatTimeDomainData(timeData);
    microphoneAnalyser.getFloatFrequencyData(frequencyData);

    const rms = getRms(timeData);
    updateLevel(rms);
    const detected = rms > 0.004
        ? detectPolyphonicNotes(frequencyData, microphoneContext.sampleRate, microphoneAnalyser.fftSize)
        : [];

    noteHistory.push(new Set(detected));
    if (noteHistory.length > 4) noteHistory.shift();
    const stable = new Set();
    for (let midi = FIRST_MIDI; midi <= LAST_MIDI; midi += 1) {
        const appearances = noteHistory.reduce((count, frame) => count + Number(frame.has(midi)), 0);
        if (appearances >= 2) stable.add(midi);
    }
    updateRecordedNotes(stable, performance.now() - recordingStartedAt);
    renderDetectedNotes(stable);
}

async function startListening() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone access requires a supported browser on HTTPS or localhost.');
    }

    microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
            channelCount: 1,
            echoCancellation: false,
            autoGainControl: false,
            noiseSuppression: false
        }
    });

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    microphoneContext = new AudioContextClass();
    await microphoneContext.resume();
    const source = microphoneContext.createMediaStreamSource(microphoneStream);
    microphoneAnalyser = microphoneContext.createAnalyser();
    microphoneAnalyser.fftSize = 16384;
    microphoneAnalyser.smoothingTimeConstant = 0.18;
    source.connect(microphoneAnalyser);

    stopReplay();
    recordedSegments = [];
    openRecordedNotes.clear();
    listening = true;
    noteHistory = [];
    lastAnalysisTime = 0;
    recordingStartedAt = performance.now();
    performancePanel.hidden = false;
    replayButton.disabled = true;
    replayLabel.textContent = 'Replay recorded notes';
    replayButton.querySelector('[aria-hidden="true"]').textContent = '▶';
    updatePerformanceSummary();
    micButton.classList.add('is-listening');
    micLabel.textContent = 'Stop listening';
    setStatus('Listening to microphone', 'listening');
    detectorHint.textContent = 'Listening for a clear musical pitch…';
    microphoneFrame = requestAnimationFrame(analyzeAudio);
}

async function stopListening() {
    listening = false;
    if (recordingStartedAt) finalizeRecording();
    recordingStartedAt = 0;
    if (microphoneFrame) cancelAnimationFrame(microphoneFrame);
    microphoneFrame = 0;
    if (microphoneStream) {
        microphoneStream.getTracks().forEach(track => track.stop());
        microphoneStream = null;
    }
    microphoneAnalyser = null;
    stopMonitorVoices();
    renderDetectedNotes(new Set());
    levelBar.style.width = '0';

    if (microphoneContext && microphoneContext.state !== 'closed') {
        await microphoneContext.close();
    }
    microphoneContext = null;
    micButton.classList.remove('is-listening');
    micLabel.textContent = 'Start listening';
    setStatus('Ready when you are');
    detectorHint.textContent = 'Start listening to see detected notes here.';
}

micButton.addEventListener('click', async () => {
    micButton.disabled = true;
    try {
        if (listening) {
            await stopListening();
        } else {
            await startListening();
        }
    } catch (error) {
        await stopListening();
        const message = error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError'
            ? 'Microphone permission was denied'
            : error.name === 'NotFoundError'
                ? 'No microphone was found'
                : error.message || 'Could not start the microphone';
        setStatus(message, 'error');
        detectorHint.textContent = 'Check microphone access and try again.';
    } finally {
        micButton.disabled = false;
    }
});

monitorToggle.addEventListener('change', () => {
    if (!monitorToggle.checked) stopMonitorVoices();
    else if (activeDetectedNotes.size && listening) updateMonitorVoices(activeDetectedNotes);
});

replayButton.addEventListener('click', () => {
    replayRecording().catch(error => {
        stopReplay();
        setStatus(error.message || 'Could not replay the recording', 'error');
    });
});

createKeyboard();
