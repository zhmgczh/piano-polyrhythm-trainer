// Computer keyboard, MIDI and pointer input. Everything is normalized to
// { hand, finger, midi, time (performance.now() ms), source }.

// Home-row keys map to fingers exactly like a five-finger position on the piano.
export const FINGER_KEYS = {
  KeyA: ['L', 5], KeyS: ['L', 4], KeyD: ['L', 3], KeyF: ['L', 2], KeyG: ['L', 1],
  KeyH: ['R', 1], KeyJ: ['R', 2], KeyK: ['R', 3], KeyL: ['R', 4], Semicolon: ['R', 5],
};
export const FINGER_KEY_LABEL = {
  L: { 5: 'A', 4: 'S', 3: 'D', 2: 'F', 1: 'G' },
  R: { 1: 'H', 2: 'J', 3: 'K', 4: 'L', 5: ';' },
};

// Any other key on the left / right half of the keyboard also counts for that hand.
const LEFT_ZONE = new Set(['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB']);
const RIGHT_ZONE = new Set(['KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash', 'Quote']);

export function handForCode(code) {
  if (FINGER_KEYS[code]) return { hand: FINGER_KEYS[code][0], finger: FINGER_KEYS[code][1] };
  if (LEFT_ZONE.has(code)) return { hand: 'L', finger: null };
  if (RIGHT_ZONE.has(code)) return { hand: 'R', finger: null };
  return null;
}

const isTyping = (el) => el && (el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(el.type) || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

export class InputManager {
  /**
   * handlers: {
   *   onPress({ hand, finger, midi, time, source, code }),
   *   onRelease({ hand, finger, midi, source, code }),
   *   onShortcut(event) -> boolean (true when handled),
   *   midiToHand(midi) -> { hand, finger },
   *   onMidiState({ status, names }),
   * }
   */
  constructor(handlers) {
    this.h = handlers;
    this.down = new Set();
    this.midi = null;
    this.midiInputId = 'all';
    window.addEventListener('keydown', (e) => this.keydown(e));
    window.addEventListener('keyup', (e) => this.keyup(e));
    window.addEventListener('blur', () => this.releaseAll());
  }

  keydown(e) {
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]:not(#dlg-calibrate)')) return;
    if (this.h.onShortcut?.(e)) return;
    if (e.shiftKey) return;
    const m = handForCode(e.code);
    if (!m) return;
    e.preventDefault();
    if (e.repeat || this.down.has(e.code)) return;
    this.down.add(e.code);
    this.h.onPress({ ...m, midi: null, time: e.timeStamp || performance.now(), source: 'key', code: e.code });
  }

  keyup(e) {
    if (!this.down.has(e.code)) return;
    this.down.delete(e.code);
    const m = handForCode(e.code);
    if (m) this.h.onRelease({ ...m, midi: null, source: 'key', code: e.code });
  }

  releaseAll() {
    for (const code of this.down) {
      const m = handForCode(code);
      if (m) this.h.onRelease({ ...m, midi: null, source: 'key', code });
    }
    this.down.clear();
  }

  /** Pointer press from the on-screen piano or the hand lights. */
  pointer(hand, finger, midi, time) {
    this.h.onPress({ hand, finger, midi, time, source: 'pointer' });
  }

  get midiSupported() { return typeof navigator.requestMIDIAccess === 'function'; }

  async connectMidi() {
    if (!this.midiSupported) { this.h.onMidiState?.({ status: 'unsupported', names: [] }); return; }
    try {
      this.midi = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      this.h.onMidiState?.({ status: 'denied', names: [] });
      return;
    }
    this.midi.onstatechange = () => this.bindMidi();
    this.bindMidi();
  }

  setMidiInput(id) {
    this.midiInputId = id;
    this.bindMidi();
  }

  bindMidi() {
    if (!this.midi) return;
    const inputs = [...this.midi.inputs.values()];
    for (const inp of inputs) {
      const use = this.midiInputId === 'all' || inp.id === this.midiInputId;
      inp.onmidimessage = use ? (msg) => this.midiMessage(msg) : null;
    }
    this.h.onMidiState?.({ status: inputs.length ? 'ready' : 'none', names: inputs.map((i) => ({ id: i.id, name: i.name || 'MIDI' })) });
  }

  midiMessage(msg) {
    const [st, note, vel] = msg.data;
    const cmd = st & 0xf0;
    if (cmd === 0x90 && vel > 0) {
      const m = this.h.midiToHand(note);
      this.h.onPress({ ...m, midi: note, time: msg.timeStamp || performance.now(), source: 'midi', velocity: vel / 127 });
    } else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) {
      const m = this.h.midiToHand(note);
      this.h.onRelease({ ...m, midi: note, source: 'midi' });
    }
  }
}
