# Pianissist AI

A browser-based piano and live pitch visualizer. It analyzes microphone input locally with the Web Audio API and highlights estimated notes on a playable C2–B5 keyboard. No API key, paid service, audio upload, or recording is used.

## Use

1. Select **Start listening** and allow microphone access.
2. Play or sing within the keyboard range (C2–B5). The estimated notes light up and appear above the piano.
3. Optionally enable **Play detected notes** to hear a quiet synthesized monitor. Leave it off when using speakers near the microphone to avoid acoustic feedback.
4. Select **Stop listening** to stop the microphone and clear the live display.
5. After listening, use **Replay recorded notes** to play back the detected performance with its recorded note spacing and simultaneous notes. Select **Stop replay** to end playback early.

The piano keys can also be clicked, tapped, or keyboard-focused and played directly.

## Accuracy notes

The detector uses a long-window FFT with harmonic scoring and short temporal voting to estimate multiple simultaneous pitches. It is intended for clear, sustained musical tones. It is not a source-separation or song-identification system: dense mixes, percussion, strong reverb, quiet fundamentals, and notes outside C2–B5 can produce missed or extra estimates. For best results, use a clean microphone signal and one instrument at a time. The **Play detected notes** option is an approximate monitor, not a transcription playback.

The replay feature records detected note start/end transitions and gaps in memory for the current listening session. It is a playback of detected notes, not the original audio.
