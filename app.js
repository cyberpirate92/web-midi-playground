/**
 * @typedef {Object} MusicNote
 * @property {string} noteName
 * @property {number} noteNumber
 * @property {number} noteFrequency
 */

/**
 * @typedef {Object} SequenceRecord
 * @property {number} id Unique ID
 * @property {string} name Optional name
 * @property {MusicNote[]} sequence Note sequence
 * @property {Date} timestamp Record creation time
 */

let sweepLength = 1;
let attackTime = 0.2;
let releaseTime = 0.5;
let baseFrequency = 440;
let isPlaying = false;
let selectedWaveType = 'custom';
const AudioContext = window.AudioContext || window.webkitAudioContext;
const Notes = ['C', 'C#/D♭', 'D', 'D#/E♭', 'E', 'F', 'F#/G♭', 'G', 'G#/A♭', 'A', 'A#/B♭', 'B'];

const TEMPLATES = {
    NO_RECORDINGS: "NoRecordings",
    RECORDING_ITEM: "RecordingItem",
};

let isRecording = false;

/** @type {number} */
let animationFrameRequest;

/**
 * Temporary buffer for storing the 
 * current recording
 * 
 * @type {SequenceRecord} 
 */
let currentRecording;

/**
 * All recordings done in this session 
 * will be stored here
 * 
 * @type {SequenceRecord[]} 
 * */
let records = [];

// These values are for Arturia MiniLab mkII
// Values might differ for other MIDI keyboards
const MIDI_MESSAGE_TYPE = {
    DRUMPAD_HOLD: 153,
    DRUMPAD_RELEASE: 137,
    KNOB_ROTATE: 176,
    KEY_PRESS: 144,
    KEY_RELEASE: 128,
};

/** @type {HTMLInputElement} */
let baseFrequencyControl;

/** @type {HTMLInputElement} */
let sweepLengthControl;

/** @type {HTMLInputElement} */
let attackControl;

/** @type {HTMLInputElement} */
let releaseControl;

/** @type {HTMLSelectElement} */
let waveTypeDropdown;

/** @type {HTMLButtonElement} */
let playPauseButton;

/** @type {HTMLButtonElement}  */
let recordButton;

/** @type {PeriodicWave} */
let wave;

/** @type {AudioContext} */
let audioCtx;

/** @type {AnalyserNode} */
let analyser;

/** @type {HTMLElement} */
let eventLog;

/** @type {HTMLCanvasElement} */
let canvas;

/** @type {CanvasRenderingContext2D} */
let canvasContext;

/** @type {Uint8Array} */
let dataArray;

/** @type {number} */
let bufferLength;

updateRecordsView();

baseFrequencyControl = document.querySelector('#baseFrequency');
sweepLengthControl = document.querySelector('#sweepLength');
attackControl = document.querySelector('#attack');
releaseControl = document.querySelector('#release');
waveTypeDropdown = document.querySelector('#waveType');
playPauseButton = document.querySelector('#playPauseButton');
recordButton = document.querySelector('#recordButton');
eventLog = document.querySelector('#eventLog');
canvas = document.querySelector('#waveform');
canvasContext = canvas.getContext('2d');

window.addEventListener('resize', () => {
    // updateCanvasSize();
});

playPauseButton.addEventListener('click', () => {
    if (!isPlaying) {
        audioCtx = new AudioContext();
        analyser = audioCtx.createAnalyser();
        if (!dataArray || dataArray.length != analyser.frequencyBinCount) {
            bufferLength = analyser.frequencyBinCount;
            dataArray = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.fftSize = 2048;
        analyser.getByteTimeDomainData(dataArray);
        startOscilloscope();
        playPauseButton.textContent = "Pause";
        playPauseButton.classList.remove('btn-success');
        playPauseButton.classList.add('btn-danger');
        recordButton.disabled = false;
    } else {
        stopOscilloscope();
        audioCtx && audioCtx.close();
        playPauseButton.textContent = "Play";
        playPauseButton.classList.remove('btn-danger');
        playPauseButton.classList.add('btn-success');
        if (isRecording) {
            stopRecording();
        }
        recordButton.disabled = true;
    }
    isPlaying = !isPlaying;
});

recordButton.addEventListener('click', () => {
    isRecording ? stopRecording() : startRecording();
});

baseFrequencyControl.addEventListener('input', () => {
    baseFrequency = Number(baseFrequencyControl.value);
    baseFrequencyControl.parentElement.querySelector('output').value = baseFrequency;
});

sweepLengthControl.addEventListener('input', () => {
    sweepLength = Number(sweepLengthControl.value);
    sweepLengthControl.parentElement.querySelector('output').value = sweepLength;
});

attackControl.addEventListener('input', () => {
    attackTime = Number(attackControl.value);
    attackControl.parentElement.querySelector('output').value = attackTime;
}, false);

releaseControl.addEventListener('input', () => {
    releaseTime = Number(releaseControl.value);
    releaseControl.parentElement.querySelector('output').value = releaseTime;
}, false);

waveTypeDropdown.addEventListener('change', () => {
    selectedWaveType = waveTypeDropdown.value.toLowerCase();
});

navigator.requestMIDIAccess().then(function(midiAccess) {
    midiAccess.inputs.forEach(input => {
        console.log(input);
        input.onmidimessage = onMIDIMessage;
    });
    midiAccess.onstatechange = function(e) {
        if (e.port.state === 'disconnected') {
            document.querySelector('#noKeyboardConnectedAlert').classList.remove('d-none');
        } else {
            document.querySelector('#noKeyboardConnectedAlert').classList.add('d-none');
        }
        let message = `${e.port.name} ${e.port.manufacturer} ${e.port.state}`;
        logEvent(message);
    };
});

function startRecording() {
    currentRecording = {
        name: `New Recording`,
        sequence: [],
        timestamp: new Date(),
        id: records.length + 1,
    };
    recordButton.textContent = 'Stop Recording';
    recordButton.classList.remove('btn-primary');
    recordButton.classList.add('btn-danger');
    isRecording = true;
}

function stopRecording() {
    if (currentRecording) {
        addRecord(currentRecording);
        currentRecording = null;
    }
    recordButton.textContent = 'Record';
    recordButton.classList.remove('btn-danger');
    recordButton.classList.add('btn-primary');
    isRecording = false;
}

/**
 * Play a sweeping wave
 * @param {number} noteFrequency 
 */
function playSweep(noteFrequency) {
    let osc = audioCtx.createOscillator();
    osc.connect(analyser);
    if (selectedWaveType === 'custom') {
        wave = audioCtx.createPeriodicWave(wavetable.real, wavetable.imag);
        osc.setPeriodicWave(wave);
    } else {
        osc.type = selectedWaveType;
        osc.frequency.value = noteFrequency;
    }
    
    let sweepEnv = audioCtx.createGain();
    sweepEnv.gain.cancelAndHoldAtTime(audioCtx.currentTime);
    // sweepEnv.gain.cancelScheduledValues(audioCtx.currentTime);
    //sweepEnv.gain.setValueAtTime(0, audioCtx.currentTime);
    // set our attack
    //sweepEnv.gain.linearRampToValueAtTime(1, audioCtx.currentTime + attackTime);
    // set our release
    // sweepEnv.gain.linearRampToValueAtTime(0, audioCtx.currentTime + sweepLength - releaseTime);
    
    osc.connect(sweepEnv).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + sweepLength);
}

// The first value is an identifier: Knobs, Keys, drumpads, etc 
// The second value is the note
// The third value is the velocity key press (I'm guessing)
function onMIDIMessage( event ) {
    let str = "MIDI message received at timestamp " + (event.timestamp || 'Unknown') + "[" + event.data.length + " bytes]: ";
    for (let i=0; i<event.data.length; i++) {
        str += "0x" + event.data[i].toString(16) + " ";
    }
    
    let typeName        = 'UNKNOWN';
    const typeId        = event.data[0];
    const noteNumber    = event.data[1];
    const velocity      = event.data[2];
    const noteName      = identifyNote(noteNumber);
    const noteFrequency = getFrequency(event.data[1]);;

    switch (typeId) {
        case MIDI_MESSAGE_TYPE.KNOB:
            typeName = 'Knob';
            break;
        case MIDI_MESSAGE_TYPE.KEY_PRESS:
            if (isPlaying) {
                playSweep(noteFrequency);
            }
            if (isRecording) {
                currentRecording.sequence.push({noteNumber, noteName, noteFrequency});
            }
            typeName = 'Key Press';
            logEvent(`Key press: ${noteName}, Frequency: ${noteFrequency}`);
            break;
        case MIDI_MESSAGE_TYPE.KEY_RELEASE:
            typeName = 'Key Release';
            break;
        case MIDI_MESSAGE_TYPE.DRUMPAD_HOLD:
            typeName = 'Drumpad Hold';
            break;
        case MIDI_MESSAGE_TYPE.DRUMPAD_RELEASE:
            typeName = 'Drumpad Release';
            break;
    }

    console.group('MIDI Message Event');
    console.log(str);
    console.log(event.data);
    console.log('Note Type   : ', typeId);
    console.log('Note Number : ', noteNumber);
    console.log('Velocity    : ', velocity);
    console.log('Note Type   : ', typeName);
    console.log('Note Name   : ', noteName);
    console.log('Frequency   : ', noteFrequency);
    console.groupEnd();
}

/**
 * Identify note value based on note number
 * @param {number} noteValue 
 * 
 * @returns {string}
 */
function identifyNote(noteValue) {
    if (!noteValue) {
        return "Unknown";
    }
    let octaveNumber = (noteValue / 12.0).toFixed(0); 
    let noteNumber = Math.abs(noteValue) % 12;
    let noteName = Notes[noteNumber];
    if (noteName.length === 1) {
        return `${noteName}${octaveNumber}`;
    } else {
        return noteName.replace('#', `${octaveNumber}#`).replace('♭', `${octaveNumber}♭`);
    }
}

/**
 * Get frequency based on Note number
 * @param {number} noteNumber 
 * 
 * @returns {number} frequency in Hertz
 */
function getFrequency(noteNumber) {
    return Math.pow(2, ((noteNumber-49)/12.0)) * baseFrequency;
}

/**
 * Play provided note sequence
 * @param {MusicNote[]} noteSequence
 * @param {number} speed 
 */
function playSequence(noteSequence, speed = 1) {
    if (noteSequence && noteSequence.length > 0) {
        let current = 0;
        let intervalRef = window.setInterval(() => {
            playSweep(noteSequence[current].noteFrequency);
            current += 1;
            if (current >= noteSequence.length) {
                window.clearInterval(intervalRef);
            }
        }, 250/speed);
    }
}

/**
 * Plays the specified record if it exists
 * 
 * @param {number} recordId 
 */
function playRecord(recordId) {
    if (!recordId) {
        return;
    }
    let record = records.find(r => r.id === recordId);
    if (record) {
        playSequence(record.sequence, 1);
    }
}

/**
 * @param {SequenceRecord} recording 
 */
function addRecord(recording) {
    if (recording.sequence.length > 0) {
        records.push(recording);
        updateRecordsView();
    }
}

/**
 * Clone template node to new DOM Element
 * @param {string} templateId
 * 
 * @returns {HTMLElement} 
 */
function fromTemplate(templateId) {
    let templateContent;
    let templateRef = document.querySelector("#" + templateId);
    if (templateRef) {
        templateContent = document.importNode(templateRef.content.firstElementChild, true);
    }
    return templateContent;
}

/**
 * Refresh records list table
 */
function updateRecordsView() {
    /** @type {HTMLElement} */
    let recordsView = document.querySelector('#recordsView');
    removeAllChildren(recordsView);
    
    if (records.length == 0) {
        recordsView.appendChild(fromTemplate(TEMPLATES.NO_RECORDINGS));
        return;
    }

    records.forEach(record => {
        let itemView = fromTemplate(TEMPLATES.RECORDING_ITEM);
        itemView.querySelector('[data-name]').textContent = record.name;
        itemView.querySelector('[data-length]').textContent = record.sequence.length;
        itemView.querySelector('[data-duration]').textContent = `${(record.sequence.length/4).toFixed()} seconds`;
        itemView.querySelector('[data-play]').addEventListener('click', () => playRecord(record.id));
        recordsView.appendChild(itemView);
    });
}

/**
 * Remove all child nodes from given node
 * @param {HTMLElement} node 
 */
function removeAllChildren(node) {
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}

function logEvent(message) {
    console.log(message);
    const timeNow = (new Date()).toTimeString().substring(0, 8);
    let row = document.createElement('div');
    let bold = document.createElement('b');
    let span = document.createElement('span');
    bold.textContent = `${timeNow}: `;
    span.textContent = `${message}`;
    row.appendChild(bold);
    row.appendChild(span);
    eventLog.prepend(row);
}

function stopOscilloscope() {
    window.cancelAnimationFrame(animationFrameRequest);
}

/**
 * Draw oscilloscope for current audio source on the canvas
 */
function startOscilloscope() {
  animationFrameRequest = window.requestAnimationFrame(startOscilloscope);
  analyser.getByteTimeDomainData(dataArray);

  canvasContext.fillStyle = "rgb(0, 0, 0)";
  canvasContext.fillRect(0, 0, canvas.width, canvas.height);

  canvasContext.lineWidth = 2;
  canvasContext.strokeStyle = "rgb(0, 225, 0)";

  canvasContext.beginPath();

  let sliceWidth = canvas.width * 1.0 / bufferLength;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {

    let v = dataArray[i] / 128.0;
    let y = v * canvas.height / 2;

    if (i === 0) {
      canvasContext.moveTo(x, y);
    } else {
      canvasContext.lineTo(x, y);
    }

    x += sliceWidth;
  }

  canvasContext.lineTo(canvas.width, canvas.height / 2);
  canvasContext.stroke();
}