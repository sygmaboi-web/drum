/* =========================================================
   Airdrum — style.css
   Dark mode, variabel warna, Flexbox/Grid, transisi halus
   ========================================================= */

:root {
  --bg: #0e1218;
  --surface: #171c26;
  --surface-2: #1f2633;
  --line: #2c3547;
  --text: #ebe8e1;
  --muted: #9aa3b2;
  --brass: #e2ab3f;   /* aksen utama (cymbal, tombol utama) */
  --hit: #8ef0dc;     /* aksen umpan balik pukulan */
  --rec: #ff5468;
  --radius: 12px;
  --font-display: 'Bricolage Grotesque', 'Segoe UI', system-ui, sans-serif;
  --font-body: 'Figtree', system-ui, -apple-system, 'Segoe UI', sans-serif;
  color-scheme: dark;
}

*, *::before, *::after { box-sizing: border-box; }

html, body { height: 100%; margin: 0; }

body {
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
  font: 400 15px/1.45 var(--font-body);
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
}

h1, h2 { font-family: var(--font-display); margin: 0; }
h2 { font-size: 1rem; margin: 1.25rem 0 .25rem; }
code { background: var(--surface-2); padding: .05em .35em; border-radius: 5px; font-size: .9em; }

:focus-visible { outline: 2px solid var(--hit); outline-offset: 2px; }

/* ---------------------------------------------------------
   Top bar
   --------------------------------------------------------- */
.topbar {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: .6rem 1rem;
  padding-top: max(.6rem, env(safe-area-inset-top));
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  z-index: 30;
}

.brand {
  font: 700 1.35rem var(--font-display);
  letter-spacing: -.01em;
  color: var(--brass);
}

.tools {
  display: flex;
  align-items: center;
  gap: .5rem;
  margin-left: auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.tools::-webkit-scrollbar { display: none; }

.btn {
  flex: none;
  font: 600 .875rem var(--font-body);
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: .55rem 1rem;
  cursor: pointer;
  white-space: nowrap;
  transition: background .15s, border-color .15s, transform .1s;
}
.btn:hover { border-color: #46536e; }
.btn:active { transform: scale(.97); }
.btn.small { padding: .35rem .8rem; font-size: .8rem; }
.btn.primary { background: var(--brass); border-color: transparent; color: #1a1405; }
.btn.primary:hover { background: #efb94d; }
.btn[aria-pressed="true"] { background: #23443f; border-color: var(--hit); }

.btn.rec { display: inline-flex; align-items: center; gap: .5rem; }
.rec-dot { width: .6rem; height: .6rem; border-radius: 50%; background: var(--rec); }
.btn.rec.on { border-color: var(--rec); }
.btn.rec.on .rec-dot { animation: blink 1s steps(2, start) infinite; }
@keyframes blink { to { visibility: hidden; } }

.status {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: .45rem;
  font-size: .82rem;
  color: var(--muted);
}
.status::before {
  content: '';
  width: .55rem; height: .55rem; border-radius: 50%;
  background: var(--line);
  transition: background .2s;
}
.status[data-state="loading"]::before { background: var(--brass); }
.status[data-state="on"]::before { background: var(--hit); }
.status[data-state="error"]::before { background: var(--rec); }

/* Metronom */
.pill {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: .4rem;
  padding: .2rem .8rem .2rem .25rem;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 999px;
}
.icon-btn {
  width: 2rem; height: 2rem;
  border: 0; border-radius: 50%;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  font-size: .8rem;
  transition: background .15s;
}
.icon-btn:hover { background: #2a3345; }
.icon-btn.on { background: var(--brass); color: #1a1405; }
.pill input[type="number"] {
  width: 3.4rem; padding: .25rem .3rem;
  background: transparent; border: 0; color: var(--text);
  font: 600 1rem var(--font-body);
  text-align: right;
}
.unit { font-size: .75rem; color: var(--muted); }
.beat-dot { width: .6rem; height: .6rem; border-radius: 50%; background: var(--line); transition: background .08s; }
.beat-dot.on { background: var(--brass); }
.beat-dot.accent { background: var(--hit); }

/* ---------------------------------------------------------
   Stage
   --------------------------------------------------------- */
.workspace { position: relative; flex: 1; min-height: 0; }

.stage {
  position: absolute; inset: 0;
  overflow: hidden;
  touch-action: none;
  background: radial-gradient(ellipse at 50% 25%, #1f2839 0%, var(--bg) 70%);
}

/* Feed webcam: di-mirror (scaleX(-1)) supaya bergerak seperti cermin */
.stage video {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  transform: scaleX(-1);
  opacity: 0;
  filter: grayscale(.35) contrast(1.05);
  transition: opacity .4s;
}
.stage.cam-on video { opacity: var(--video-opacity, .35); }

.stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 4; }

.pieces { position: absolute; inset: 0; z-index: 3; }

/* ---------------------------------------------------------
   Drum pieces
   Ukuran memakai font-size supaya semua bagian dalam bisa
   diskalakan dengan satuan em.
   --------------------------------------------------------- */
.piece {
  position: absolute;
  left: calc(var(--x) * 1%);
  top: calc(var(--y) * 1%);
  font-size: calc(var(--s) * var(--zone-scale, 1) * 1vmin);
  width: 1em; height: 1em;
  transform: translate(-50%, -50%);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}

.piece .disc { position: absolute; inset: 0; border-radius: 50%; }

.piece .glow {
  position: absolute; inset: -14%;
  border-radius: 50%;
  background: radial-gradient(circle, hsl(var(--hue) 100% 70% / .6), transparent 68%);
  opacity: 0;
  pointer-events: none;
}
.piece .ring {
  position: absolute; inset: 0;
  border-radius: 50%;
  border: .03em solid hsl(var(--hue) 100% 78%);
  pointer-events: none;
}

/* Drum: tom, snare */
.piece[data-type="drum"] .disc {
  background: radial-gradient(circle at 34% 28%, hsl(var(--hue) 20% 97% / .95), hsl(var(--hue) 18% 84% / .93) 62%, hsl(var(--hue) 20% 70% / .93));
  border: .075em solid hsl(var(--hue) 58% 40%);
  box-shadow: 0 0 0 .02em #d6dae2, 0 .05em .14em rgba(0,0,0,.55), inset 0 0 .12em rgba(0,0,0,.28);
}

/* Kick: kepala depan gelap dengan lingkar terang */
.piece[data-type="kick"] .disc {
  background: radial-gradient(circle, hsl(var(--hue) 35% 10%) 0 20%, hsl(var(--hue) 30% 19%) 21% 57%, hsl(var(--hue) 30% 86%) 58% 100%);
  border: .07em solid hsl(var(--hue) 55% 38%);
  box-shadow: 0 0 0 .02em #d6dae2, 0 .06em .16em rgba(0,0,0,.6);
}

/* Cymbal: kilau logam + alur konsentris */
.piece[data-type="cymbal"] .disc {
  background:
    radial-gradient(circle, hsl(var(--hue) 75% 28%) 0 7%, hsl(var(--hue) 80% 72%) 8% 11%, transparent 12%),
    conic-gradient(from 30deg, hsl(var(--hue) 80% 66% / .62), hsl(var(--hue) 70% 36% / .62), hsl(var(--hue) 85% 74% / .62), hsl(var(--hue) 65% 34% / .62), hsl(var(--hue) 80% 66% / .62)),
    repeating-radial-gradient(circle, hsl(var(--hue) 60% 52%) 0 1.5%, hsl(var(--hue) 60% 40%) 1.5% 3%);
  box-shadow: 0 .05em .14em rgba(0,0,0,.5), inset 0 0 0 .012em hsl(var(--hue) 90% 82% / .7);
}

.piece .label {
  position: absolute; inset: 0;
  display: grid; place-items: center;
  padding: 0 12%;
  font: 700 clamp(.62rem, .12em, .95rem)/1.1 var(--font-display);
  text-align: center;
  color: rgba(12, 14, 20, .85);
  text-shadow: 0 1px 0 rgba(255,255,255,.25);
  pointer-events: none;
}
.piece[data-type="kick"] .label { color: #eceae4; text-shadow: none; }

.piece .keycap {
  position: absolute; left: 50%; top: 100%;
  transform: translateX(-50%);
  margin-top: .35rem;
  padding: .1rem .5rem;
  font: 600 .72rem var(--font-body);
  color: var(--muted);
  background: rgba(14, 18, 24, .85);
  border: 1px solid var(--line);
  border-radius: 6px;
  pointer-events: none;
  white-space: nowrap;
}

/* Jari sedang berada di atas zona (panduan visual) */
.piece.hover::after {
  content: '';
  position: absolute; inset: -5%;
  border-radius: 50%;
  border: 2px dashed hsl(var(--hue) 100% 82% / .85);
  pointer-events: none;
}

/* Mode atur posisi */
.stage.editing .piece { cursor: grab; }
.stage.editing .piece::before {
  content: '';
  position: absolute; inset: -6%;
  border-radius: 50%;
  border: 2px dashed rgba(255,255,255,.4);
  pointer-events: none;
}
.piece.dragging { cursor: grabbing; z-index: 6; }

/* ---------------------------------------------------------
   Overlays: intro, edit hint, toasts, take
   --------------------------------------------------------- */
.intro {
  position: absolute; inset: 0; z-index: 10;
  display: grid; place-items: center;
  padding: 1rem;
  background: rgba(8, 10, 14, .62);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.intro[hidden] { display: none; }
.intro-card {
  max-width: 30rem;
  padding: 1.75rem;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 18px;
}
.intro-card h1 { font-size: 1.9rem; line-height: 1.1; margin-bottom: .75rem; letter-spacing: -.02em; }
.intro-card p { margin: 0 0 1.25rem; color: var(--muted); }
.intro-actions { display: flex; flex-wrap: wrap; gap: .6rem; }

.edit-hint {
  position: absolute; top: .75rem; left: 50%;
  transform: translateX(-50%);
  z-index: 8;
  display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; justify-content: center;
  width: max-content; max-width: calc(100% - 1.5rem);
  padding: .5rem .75rem;
  font-size: .85rem;
  background: rgba(23, 28, 38, .92);
  border: 1px solid var(--line);
  border-radius: 14px;
}
.edit-hint[hidden] { display: none; }

.toasts {
  position: absolute; left: .75rem; bottom: .75rem; z-index: 9;
  display: flex; flex-direction: column; gap: .4rem;
  max-width: min(24rem, calc(100% - 1.5rem));
  pointer-events: none;
}
.toast {
  padding: .55rem .85rem;
  font-size: .85rem;
  background: rgba(23, 28, 38, .95);
  border: 1px solid var(--line);
  border-radius: 10px;
  animation: toast-in .2s ease-out;
}
.toast.error { border-color: var(--rec); }
@keyframes toast-in { from { opacity: 0; transform: translateY(6px); } }

.take {
  position: absolute; left: 50%; bottom: .75rem; z-index: 9;
  transform: translateX(-50%);
  display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; justify-content: center;
  width: max-content; max-width: calc(100% - 1.5rem);
  padding: .6rem .8rem;
  background: rgba(23, 28, 38, .96);
  border: 1px solid var(--line);
  border-radius: 14px;
}
.take[hidden] { display: none; }
.take audio { height: 2.2rem; max-width: 14rem; }
.take a.btn { text-decoration: none; }

/* ---------------------------------------------------------
   Drawer (panel pengaturan)
   --------------------------------------------------------- */
.drawer {
  position: absolute; top: 0; right: 0; bottom: 0;
  z-index: 20;
  width: min(410px, 100%);
  display: flex; flex-direction: column;
  background: var(--surface);
  border-left: 1px solid var(--line);
  transform: translateX(102%);
  visibility: hidden;
  transition: transform .25s cubic-bezier(.2, .8, .2, 1), visibility 0s .25s;
}
.drawer.open { transform: none; visibility: visible; transition: transform .25s cubic-bezier(.2, .8, .2, 1), visibility 0s; }

.tabs {
  display: flex; gap: .15rem;
  padding: .5rem .75rem 0;
  border-bottom: 1px solid var(--line);
  overflow-x: auto;
  scrollbar-width: none;
}
.tab {
  flex: none;
  padding: .6rem .75rem;
  font: 600 .85rem var(--font-body);
  color: var(--muted);
  background: none; border: 0;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color .15s;
}
.tab:hover { color: var(--text); }
.tab[aria-selected="true"] { color: var(--text); border-bottom-color: var(--brass); }

.tabpanels { flex: 1; overflow-y: auto; padding: .75rem 1rem 1.5rem; }
.tabpanel[hidden] { display: none; }

.rows { display: flex; flex-direction: column; }

/* Baris pemilih suara */
.row {
  display: grid;
  grid-template-columns: 7.5rem 1fr auto;
  align-items: center;
  gap: .6rem;
  padding: .55rem 0;
  border-bottom: 1px solid var(--line);
}
.row label { display: flex; flex-direction: column; font-weight: 600; font-size: .9rem; }
.row small { font-weight: 400; font-size: .72rem; color: var(--muted); }
.row small[data-src="file"] { color: var(--hit); }

/* Baris mixer */
.mixrow {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: .15rem 1rem;
  padding: .6rem 0;
  border-bottom: 1px solid var(--line);
}
.mixrow strong { grid-column: 1 / -1; font-size: .9rem; }
.mixrow label { display: grid; grid-template-columns: 1fr auto; align-items: center; font-size: .75rem; color: var(--muted); }
.mixrow input { grid-column: 1 / -1; width: 100%; }

/* Baris tabel MIDI / keyboard */
.row3 {
  display: grid;
  grid-template-columns: 1fr 4.5rem auto;
  align-items: center;
  gap: .6rem;
  padding: .4rem 0;
  border-bottom: 1px solid var(--line);
  font-size: .9rem;
}
.row2 {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: .6rem;
  padding: .4rem 0;
  border-bottom: 1px solid var(--line);
  font-size: .9rem;
}
.mini {
  font: 600 .78rem var(--font-body);
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: .35rem .7rem;
  cursor: pointer;
  min-width: 3.2rem;
  transition: border-color .15s, background .15s;
}
.mini:hover { border-color: #46536e; }
.mini.waiting { border-color: var(--brass); color: var(--brass); }

/* Field umum */
.field {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: .35rem .8rem;
  padding: .6rem 0;
  border-bottom: 1px solid var(--line);
}
.field.slider input[type="range"] { grid-column: 1 / -1; width: 100%; }
.field output { font-size: .82rem; color: var(--muted); }

.note { margin: .9rem 0 0; font-size: .8rem; color: var(--muted); }
.muted { color: var(--muted); }
.small-text { font-size: .8rem; margin: .25rem 0 .5rem; }

select,
input[type="number"] {
  font: 500 .875rem var(--font-body);
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: .45rem .6rem;
  min-width: 0;
}
input[type="range"] { accent-color: var(--brass); }

.switch {
  appearance: none; -webkit-appearance: none;
  position: relative;
  width: 2.5rem; height: 1.4rem;
  margin: 0;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 999px;
  cursor: pointer;
  transition: background .15s, border-color .15s;
}
.switch::after {
  content: '';
  position: absolute; top: 2px; left: 2px;
  width: calc(1.4rem - 6px); height: calc(1.4rem - 6px);
  border-radius: 50%;
  background: var(--muted);
  transition: transform .15s, background .15s;
}
.switch:checked { background: #26463f; border-color: var(--hit); }
.switch:checked::after { transform: translateX(1.1rem); background: var(--hit); }

/* ---------------------------------------------------------
   Responsif
   --------------------------------------------------------- */
@media (max-width: 720px) {
  .brand { font-size: 1.1rem; }
  .topbar { gap: .6rem; padding-inline: .75rem; }

  /* Panel menjadi bottom sheet di layar kecil */
  .drawer {
    top: auto;
    width: 100%; height: 64%;
    border-left: 0;
    border-top: 1px solid var(--line);
    border-radius: 16px 16px 0 0;
    transform: translateY(102%);
  }
  .row { grid-template-columns: 6rem 1fr auto; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: .01ms !important; animation-duration: .01ms !important; }
}
