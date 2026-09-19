////////////////////////////////////////////////////
// AUDIO ENGINE
////////////////////////////////////////////////////

const audioCtx =
new (window.AudioContext || window.webkitAudioContext)();

const masterGain = audioCtx.createGain();
masterGain.connect(audioCtx.destination);

masterGain.gain.value = 0.8;

////////////////////////////////////////////////////
// INSTRUMENTS
////////////////////////////////////////////////////

const drumPieces = {
    kick:{},
    snare:{},
    closedHat:{},
    openHat:{},
    highTom:{},
    midTom:{},
    floorTom:{},
    crash:{},
    ride:{}
};

////////////////////////////////////////////////////
// 5 VARIATIONS EACH
////////////////////////////////////////////////////

const soundLibrary = {};

Object.keys(drumPieces).forEach(piece=>{

    soundLibrary[piece] = [

        `audio/${piece}-1.wav`,
        `audio/${piece}-2.wav`,
        `audio/${piece}-3.wav`,
        `audio/${piece}-4.wav`,
        `audio/${piece}-5.wav`
    ];

});

////////////////////////////////////////////////////
// MIXER
////////////////////////////////////////////////////

Object.keys(drumPieces).forEach(piece=>{

    drumPieces[piece].gain =
    audioCtx.createGain();

    drumPieces[piece].pan =
    audioCtx.createStereoPanner();

    drumPieces[piece].gain.connect(
      drumPieces[piece].pan
    );

    drumPieces[piece].pan.connect(masterGain);

    drumPieces[piece].variation=0;

});

////////////////////////////////////////////////////
// SYNTH DRUM FALLBACK
////////////////////////////////////////////////////

function synthDrum(piece, variation=0){

    const osc =
    audioCtx.createOscillator();

    const gain =
    audioCtx.createGain();

    osc.connect(gain);

    gain.connect(
      drumPieces[piece].gain
    );

    let freq = 120;

    switch(piece){

        case "kick":
            freq = 60 + variation*10;
            break;

        case "snare":
            freq = 220 + variation*40;
            break;

        case "closedHat":
            freq = 600 + variation*50;
            break;

        case "crash":
            freq = 800 + variation*100;
            break;

        default:
            freq = 180;
    }

    osc.type="triangle";

    osc.frequency.setValueAtTime(
        freq,
        audioCtx.currentTime
    );

    gain.gain.setValueAtTime(.6,audioCtx.currentTime);

    gain.gain.exponentialRampToValueAtTime(
        0.001,
        audioCtx.currentTime+0.2
    );

    osc.start();

    osc.stop(audioCtx.currentTime+0.2);
}

////////////////////////////////////////////////////
// PLAY INSTRUMENT
////////////////////////////////////////////////////

function playDrum(piece){

    synthDrum(
        piece,
        drumPieces[piece].variation
    );

    visualHit(piece);
}

////////////////////////////////////////////////////
// VISUAL FEEDBACK
////////////////////////////////////////////////////

function visualHit(piece){

    const el =
    document.querySelector(
      `[data-piece="${piece}"]`
    );

    if(!el) return;

    el.classList.add("active");

    setTimeout(()=>{

        el.classList.remove("active");

    },120);

}

////////////////////////////////////////////////////
// KEYBOARD MAP
////////////////////////////////////////////////////

const keyMap = {

    a:"kick",
    s:"snare",
    d:"closedHat",
    f:"openHat",

    q:"crash",
    w:"ride",

    e:"highTom",
    r:"midTom",
    t:"floorTom"
};

window.addEventListener("keydown",e=>{

    const instr = keyMap[e.key];

    if(instr){
        playDrum(instr);
    }

});

////////////////////////////////////////////////////
// DRAGGABLE PIECES
////////////////////////////////////////////////////

document.querySelectorAll(".draggable")
.forEach(el=>{

let offsetX=0;
let offsetY=0;
let dragging=false;

el.addEventListener("mousedown",e=>{

 dragging=true;
 offsetX=e.offsetX;
 offsetY=e.offsetY;

});

document.addEventListener("mousemove",e=>{

 if(!dragging) return;

 el.style.left=
 (e.pageX-offsetX)+"px";

 el.style.top=
 (e.pageY-offsetY)+"px";

});

document.addEventListener("mouseup",()=>{

 dragging=false;

});

});

////////////////////////////////////////////////////
// SETTINGS PANEL
////////////////////////////////////////////////////

const settingsDiv =
document.getElementById(
    "instrumentSettings"
);

Object.keys(drumPieces).forEach(piece=>{

 const div =
 document.createElement("div");

 div.className="settingBlock";

 div.innerHTML=`

 <h4>${piece}</h4>

 Variation

 <select data-piece="${piece}">
    <option value="0">Var 1</option>
    <option value="1">Var 2</option>
    <option value="2">Var 3</option>
    <option value="3">Var 4</option>
    <option value="4">Var 5</option>
 </select>

 Volume

 <input class="vol" type="range"
 min="0" max="1" step="0.01"
 value="1" data-piece="${piece}">

 Pan

 <input class="pan" type="range"
 min="-1" max="1"
 value="0"
 step="0.01"
 data-piece="${piece}">
 `;

 settingsDiv.appendChild(div);

});

////////////////////////////////////////////////////
// SETTINGS EVENTS
////////////////////////////////////////////////////

settingsDiv.addEventListener("change",e=>{

 if(e.target.tagName==="SELECT"){

    const p=
    e.target.dataset.piece;

    drumPieces[p].variation=
    Number(e.target.value);

 }

});

settingsDiv.addEventListener("input",e=>{

 const piece =
 e.target.dataset.piece;

 if(e.target.classList.contains("vol")){

    drumPieces[piece]
      .gain.gain.value =
      e.target.value;

 }

 if(e.target.classList.contains("pan")){

    drumPieces[piece]
      .pan.pan.value =
      e.target.value;
 }

});

////////////////////////////////////////////////////
// MASTER
////////////////////////////////////////////////////

document.getElementById("masterVolume")
.addEventListener("input",e=>{

 masterGain.gain.value=
 e.target.value;

});

////////////////////////////////////////////////////
// MEDIAPIPE HANDS
////////////////////////////////////////////////////

const video =
document.getElementById("video");

const handCanvas =
document.getElementById("handCanvas");

const ctx =
handCanvas.getContext("2d");

let prevY = null;

function detectHits(indexFinger){

    const x =
    indexFinger.x*window.innerWidth;

    const y =
    indexFinger.y*window.innerHeight;

    const velocity =
    prevY===null ? 0 : y-prevY;

    prevY = y;

    if(velocity < 20) return;

    document.querySelectorAll(".drum")
    .forEach(drum=>{

        const rect =
        drum.getBoundingClientRect();

        const inside=
        x>rect.left &&
        x<rect.right &&
        y>rect.top &&
        y<rect.bottom;

        if(inside){

            playDrum(
             drum.dataset.piece
            );

        }

    });
}

const hands = new Hands({

 locateFile:(file)=>{
  return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
 }

});

hands.setOptions({

 maxNumHands:2,
 minDetectionConfidence:0.7,
 minTrackingConfidence:0.7

});

hands.onResults(results=>{

 ctx.clearRect(
 0,0,
 handCanvas.width,
 handCanvas.height
 );

 if(results.multiHandLandmarks){

   for(const lm of
      results.multiHandLandmarks){

      const tip = lm[8];

      detectHits(tip);
   }

 }

});

document.getElementById("startCam")
.addEventListener("click",()=>{

 navigator.mediaDevices
 .getUserMedia({video:true})
 .then(stream=>{

   video.srcObject=stream;

   const camera =
   new Camera(video,{

      onFrame:async()=>{

         await hands.send({
             image:video
         });

      },

      width:1280,
      height:720

   });

   camera.start();

 });

});

////////////////////////////////////////////////////
// MIDI SUPPORT
////////////////////////////////////////////////////

if(navigator.requestMIDIAccess){

 navigator.requestMIDIAccess()
 .then(midi=>{

   midi.inputs.forEach(input=>{

      input.onmidimessage=
      midiMessage;

   });

 });

}

function midiMessage(msg){

 const note =
 msg.data[1];

 switch(note){

    case 36:
        playDrum("kick");
        break;

    case 38:
        playDrum("snare");
        break;

    case 42:
        playDrum("closedHat");
        break;

    case 49:
        playDrum("crash");
        break;
 }

}

////////////////////////////////////////////////////
// METRONOME
////////////////////////////////////////////////////

let metro;

function metroClick(){

 synthDrum("closedHat");
}

document.getElementById("metroStart")
.addEventListener("click",()=>{

 const bpm =
 Number(
 document.getElementById("bpm").value
 );

 clearInterval(metro);

 metro =
 setInterval(
 metroClick,
 60000/bpm
 );

});

document.getElementById("metroStop")
.addEventListener("click",()=>{

 clearInterval(metro);

});

////////////////////////////////////////////////////
// RECORDING
////////////////////////////////////////////////////

const recorderDest =
 audioCtx.createMediaStreamDestination();

masterGain.connect(recorderDest);

let recorder;
let chunks=[];

document.getElementById("recordBtn")
.addEventListener("click",()=>{

 chunks=[];

 recorder =
 new MediaRecorder(
   recorderDest.stream
 );

 recorder.ondataavailable=
 e=>chunks.push(e.data);

 recorder.start();

});

document.getElementById("stopRecord")
.addEventListener("click",()=>{

 recorder.stop();

 recorder.onstop=()=>{

   const blob =
   new Blob(chunks,{
      type:"audio/webm"
   });

   const a =
   document.createElement("a");

   a.href=
   URL.createObjectURL(blob);

   a.download=
   "drum-recording.webm";

   a.click();

 };

});
