// The meeting recorder's tap (21 Oct 2026, gap G18; two sources 22 Oct 2026; state/recorder.ts): runs in the audio thread
// and hands the window the microphone's samples (input 0) and the PC's sound's (input 1, when it is recorded) in blocks
// of 4096 (about a tenth of a second), kept apart so the window can tell who is talking, turn the microphone down while
// the call talks, and cut the speech into pieces to write down. A file of its own, loaded from Ironleaf's own files,
// because the window's security rules allow scripts only from there.
class NvTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 4096;
    this.mic = new Float32Array(this.size);
    this.pc = new Float32Array(this.size);
    this.hasPc = false;
    this.n = 0;
  }

  process(inputs) {
    const mic = inputs[0] && inputs[0][0];
    const pc = inputs[1] && inputs[1][0];
    const len = (mic && mic.length) || (pc && pc.length) || 0;
    if (pc) this.hasPc = true;
    for (let i = 0; i < len; i++) {
      this.mic[this.n] = mic ? mic[i] : 0;
      this.pc[this.n] = pc ? pc[i] : 0;
      this.n++;
      if (this.n === this.size) {
        this.port.postMessage({ mic: this.mic, pc: this.hasPc ? this.pc : null }, this.hasPc ? [this.mic.buffer, this.pc.buffer] : [this.mic.buffer]);
        this.mic = new Float32Array(this.size);
        this.pc = new Float32Array(this.size);
        this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor('nv-tap', NvTap);
