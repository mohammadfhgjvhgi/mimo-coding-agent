import { createHash, randomBytes } from 'node:crypto';
import WebSocket from 'ws';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const WINDOWS_FILE_TIME_EPOCH = 11644473600n;

function generateSecMsGecToken(): string {
  const ticks = BigInt(Math.floor((Date.now() / 1000) + Number(WINDOWS_FILE_TIME_EPOCH))) * 10000000n;
  const roundedTicks = ticks - (ticks % 3000000000n);
  const str = `${roundedTicks}${TRUSTED_CLIENT_TOKEN}`;
  return createHash('sha256').update(str, 'ascii').digest('hex').toUpperCase();
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&"']/g, (c) => {
    switch (c) { case '<': return '&lt;'; case '>': return '&gt;'; case '&': return '&amp;'; case '"': return '&quot;'; case "'": return '&apos;'; default: return c; }
  });
}

export interface EdgeTtsOptions {
  voice: string;
  rate?: string;
  pitch?: string;
  volume?: string;
  lang?: string;
  timeout?: number;
}

export function edgeTtsSynthesize(text: string, options: EdgeTtsOptions): Promise<{ audio: Buffer; format: string }> {
  const { voice, rate = '+0%', pitch = '+0Hz', volume = '+0%', lang, timeout = 30000 } = options;
  const derivedLang = lang ?? voice.split('-').slice(0, 2).join('-');

  return new Promise((resolve, reject) => {
    const token = generateSecMsGecToken();
    const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${token}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}`;

    const ws = new WebSocket(url, {
      host: 'speech.platform.bing.com',
      origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      headers: {
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/${CHROMIUM_FULL_VERSION.split('.')[0]}.0.0.0`,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const audioChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch {}
      reject(new Error('Edge TTS timed out after ' + timeout + 'ms'));
    }, timeout);

    ws.on('open', () => {
      ws.send('Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}');
      setTimeout(() => {
        const requestId = randomBytes(16).toString('hex');
        const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${derivedLang}"><voice name="${voice}"><prosody rate="${rate}" pitch="${pitch}" volume="${volume}">${escapeXml(text)}</prosody></voice></speak>`;
        ws.send(`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n` + ssml);
      }, 400);
    });

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (settled) return;
      if (isBinary) {
        const separator = Buffer.from('Path:audio\r\n');
        const idx = data.indexOf(separator);
        if (idx >= 0) audioChunks.push(data.subarray(idx + separator.length));
      } else {
        const msg = data.toString();
        if (msg.includes('Path:turn.end')) {
          settled = true; clearTimeout(timer);
          try { ws.close(); } catch {}
          const audio = Buffer.concat(audioChunks);
          if (audio.length === 0) reject(new Error('Edge TTS returned empty audio'));
          else resolve({ audio, format: 'mp3' });
        } else if (msg.toLowerCase().includes('error') && !msg.includes('audio.metadata')) {
          settled = true; clearTimeout(timer);
          try { ws.close(); } catch {}
          reject(new Error('Edge TTS error: ' + msg.slice(0, 300)));
        }
      }
    });

    ws.on('error', (err: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      reject(new Error('WebSocket error: ' + err.message));
    });

    ws.on('unexpected-response', (_req: any, res: any) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      let body = '';
      res.on('data', (d: Buffer) => body += d.toString());
      res.on('end', () => reject(new Error(`Edge TTS HTTP ${res.statusCode}: ${body.slice(0, 300)}`)));
    });
  });
}
