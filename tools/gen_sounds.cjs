// Generates the bundled notification tones (16-bit PCM WAV) + a data-URI snippet.
// Run: node tools/gen_sounds.js   (from the package root)
const fs = require('fs');
const path = require('path');

function wav(notes, { rate = 22050, gain = 0.6 } = {}) {
  const chunks = [];
  for (const [freq, durSec, gapSec = 0] of notes) {
    const n = Math.round(rate * durSec);
    const gap = Math.round(rate * gapSec);
    for (let i = 0; i < n + gap; i++) {
      let v = 0;
      if (i < n) {
        const t = i / rate;
        const env = Math.exp(-4.2 * t / durSec) * (1 - Math.exp(-t * 400));
        v = (Math.sin(2 * Math.PI * freq * t) * 0.8 + Math.sin(4 * Math.PI * freq * t) * 0.2) * env;
      }
      chunks.push(Math.max(-1, Math.min(1, v * gain)));
    }
  }
  const data = Buffer.alloc(chunks.length * 2);
  chunks.forEach((v, i) => data.writeInt16LE(Math.round(v * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const out = path.join(__dirname, '..', 'sounds');
fs.mkdirSync(out, { recursive: true });
const done = wav([[659.25, 0.16], [880, 0.30]]);                       // E5 → A5, calm
const alert = wav([[783.99, 0.11, 0.03], [987.77, 0.11, 0.03], [1318.5, 0.26]]); // G5 B5 E6, urgent
fs.writeFileSync(path.join(out, 'done.wav'), done);
fs.writeFileSync(path.join(out, 'alert.wav'), alert);
fs.writeFileSync(path.join(out, 'sounds-b64.json'), JSON.stringify({
  done: done.toString('base64'),
  alert: alert.toString('base64'),
}));
console.log('done.wav', done.length, 'bytes; alert.wav', alert.length, 'bytes; base64 written to sounds/sounds-b64.json');
