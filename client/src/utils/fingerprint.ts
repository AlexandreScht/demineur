export interface FingerprintResult {
  hash: string;
}

async function getGPUSignal(): Promise<string> {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') as WebGLRenderingContext | null;
    if (!gl) return 'unknown';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return 'unknown';
    return (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string) || 'unknown';
  } catch {
    return 'error';
  }
}

async function getCanvasSignal(): Promise<string> {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'unknown';
    ctx.fillStyle = '#f60';
    ctx.fillRect(10, 10, 100, 30);
    ctx.fillStyle = '#069';
    ctx.font = '16px Arial';
    ctx.fillText('fp_canvas_signal', 20, 30);
    return canvas.toDataURL();
  } catch {
    return 'error';
  }
}

async function getAudioSignal(): Promise<string> {
  try {
    const ctx = new OfflineAudioContext(1, 44100, 44100);
    const oscillator = ctx.createOscillator();
    const compressor = ctx.createDynamicsCompressor();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(10000, ctx.currentTime);
    oscillator.connect(compressor);
    compressor.connect(ctx.destination);
    oscillator.start(0);
    const buffer = await ctx.startRendering();
    const data = buffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < 500; i++) {
      sum += Math.abs(data[i]);
    }
    return sum.toString();
  } catch {
    return 'error';
  }
}

function getPlatformSignal(): string {
  try {
    return navigator.platform || 'unknown';
  } catch {
    return 'error';
  }
}

export async function getLightFingerprint(): Promise<FingerprintResult> {
  const [gpu, canvasData, audio] = await Promise.all([
    getGPUSignal(),
    getCanvasSignal(),
    getAudioSignal(),
  ]);
  const platform = getPlatformSignal();

  const raw = JSON.stringify({ gpu, canvas: canvasData, audio, platform });
  const encoded = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return { hash };
}
