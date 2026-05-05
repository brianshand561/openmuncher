import { createHmac } from 'node:crypto';
import type { MunchEvent, IngestResponse } from '@openmuncher/shared';

const TIMEOUT_MS = 2000;

export interface TelemetryOptions {
  url: string;
  secret: string;
  fetchFn?: typeof fetch;
}

export async function sendTelemetry(
  event: MunchEvent,
  opts: TelemetryOptions,
): Promise<IngestResponse | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  const body = JSON.stringify(event);
  const sig = createHmac('sha256', opts.secret).update(body).digest('hex');

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetchFn(opts.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-om-sig': sig,
          },
          body,
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) continue;
      const json = (await res.json()) as IngestResponse;
      return json;
    } catch {
      // network error / abort — retry
    }
  }
  return null;
}
