// Small bounded stereo queue; samples are produced by JSNES on the main thread.
class NESAudioQueue extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = 16384;
    this.left = new Float32Array(this.capacity);
    this.right = new Float32Array(this.capacity);
    this.read = 0;
    this.write = 0;
    this.count = 0;
    this.port.onmessage = ({ data }) => {
      if (data.reset) { this.read = this.write = this.count = 0; return; }
      const length = data.left.length;
      const overflow = Math.max(0, this.count + length - this.capacity);
      this.read = (this.read + overflow) % this.capacity;
      this.count -= overflow;
      for (let i = 0; i < length; i++) {
        this.left[this.write] = data.left[i];
        this.right[this.write] = data.right[i];
        this.write = (this.write + 1) % this.capacity;
      }
      this.count += length;
    };
  }
  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    for (let i = 0; i < left.length; i++) {
      left[i] = this.count ? this.left[this.read] : 0;
      right[i] = this.count ? this.right[this.read] : 0;
      if (this.count) { this.read = (this.read + 1) % this.capacity; this.count--; }
    }
    return true;
  }
}
registerProcessor('nes-audio-queue', NESAudioQueue);
