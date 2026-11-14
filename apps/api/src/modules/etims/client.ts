// Patch 008B-2: OSCU HTTP client for KRA eTIMS.
// Pure functions — no route imports this file yet (wiring happens in 008C).
// Retry/timeout/error mapping built in so no caller must handle transient KRA failures.

import { etimsConfig } from './config.js';

export type EtimsErrorKind =
  | 'timeout'
  | 'network'
  | 'http'
  | 'kra_reject'
  | 'invalid_response';

export class EtimsApiError extends Error {
  constructor(
    message: string,
    public readonly kind: EtimsErrorKind,
    public readonly resultCd?: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'EtimsApiError';
  }
}

export interface InitDeviceInput {
  baseUrl: string;
  tin: string;
  bhfId: string;
  dvcSrlNo: string;
}

export interface InitDeviceResult {
  cmcKey: string;
}

export interface SubmitSaleInput {
  baseUrl: string;
  tin: string;
  bhfId: string;
  cmcKey: string;
  payload: Record<string, unknown>;
}

export interface SubmitSaleResult {
  curRcptNo: number;
  totRcptNo: number;
  intrlData: string;
  rcptSign: string;
  rcptPbctDt: string;
  qrCodeUrl?: string;
  raw: unknown;
}

export interface SelectCodesInput {
  baseUrl: string;
  tin: string;
  bhfId: string;
  cmcKey: string;
  codeType: string;
}

export interface SelectCodesResult {
  clsList: Record<string, Array<{ cd: string; nm: string }>>;
  raw: unknown;
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof EtimsApiError)) return false;
  if (err.kind === 'timeout' || err.kind === 'network') return true;
  if (err.kind === 'http' && (err.statusCode ?? 0) >= 500) return true;
  return false;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function postWithRetry<T>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  parse: (raw: unknown) => T,
): Promise<T> {
  const maxAttempts = etimsConfig.ETIMS_RETRY_MAX_ATTEMPTS;
  const backoffMs = etimsConfig.ETIMS_RETRY_BACKOFF_MS;
  const timeoutMs = etimsConfig.ETIMS_DEVICE_TIMEOUT_MS;

  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      let res: Response;
      try {
        res = await fetchWithTimeout(
          url,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify(body),
          },
          timeoutMs,
        );
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          throw new EtimsApiError('request timed out', 'timeout');
        }
        throw new EtimsApiError(
          `network error: ${(e as Error).message}`,
          'network',
        );
      }

      if (res.status >= 500) {
        throw new EtimsApiError(
          `server error ${res.status}`,
          'http',
          undefined,
          res.status,
        );
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new EtimsApiError(
          `http ${res.status}: ${txt.slice(0, 200)}`,
          'http',
          undefined,
          res.status,
        );
      }

      const raw = (await res.json().catch(() => null)) as unknown;
      if (!raw || typeof raw !== 'object') {
        throw new EtimsApiError('invalid JSON response', 'invalid_response');
      }
      return parse(raw);
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e) || attempt === maxAttempts) throw e;
      await new Promise((r) => setTimeout(r, backoffMs * attempt));
    }
  }

  throw lastErr ?? new EtimsApiError('unknown error', 'network');
}

export async function initDevice(
  input: InitDeviceInput,
): Promise<InitDeviceResult> {
  return postWithRetry(
    `${input.baseUrl}/selectInitOsdcInfo`,
    { tin: input.tin, bhfId: input.bhfId, dvcSrlNo: input.dvcSrlNo },
    {},
    (raw) => {
      const r = raw as { resultCd?: string; data?: { cmcKey?: string } };
      if (r.resultCd !== '000') {
        throw new EtimsApiError(
          `init rejected: ${r.resultCd ?? 'unknown'}`,
          'kra_reject',
          r.resultCd,
        );
      }
      if (!r.data?.cmcKey || typeof r.data.cmcKey !== 'string') {
        throw new EtimsApiError('cmcKey missing in response', 'invalid_response');
      }
      return { cmcKey: r.data.cmcKey };
    },
  );
}

export async function submitSale(
  input: SubmitSaleInput,
): Promise<SubmitSaleResult> {
  return postWithRetry(
    `${input.baseUrl}/saveTrnsSalesOsdc`,
    input.payload,
    { tin: input.tin, bhfId: input.bhfId, cmcKey: input.cmcKey },
    (raw) => {
      const r = raw as {
        resultCd?: string;
        data?: {
          curRcptNo?: number;
          totRcptNo?: number;
          intrlData?: string;
          rcptSign?: string;
          rcptPbctDt?: string;
          qrCodeUrl?: string;
        };
      };
      if (r.resultCd !== '000') {
        throw new EtimsApiError(
          `sale rejected: ${r.resultCd ?? 'unknown'}`,
          'kra_reject',
          r.resultCd,
        );
      }
      const d = r.data;
      if (
        !d?.intrlData ||
        !d.rcptSign ||
        typeof d.curRcptNo !== 'number' ||
        typeof d.totRcptNo !== 'number'
      ) {
        throw new EtimsApiError('fiscal fields missing', 'invalid_response');
      }
      return {
        curRcptNo: d.curRcptNo,
        totRcptNo: d.totRcptNo,
        intrlData: d.intrlData,
        rcptSign: d.rcptSign,
        rcptPbctDt: d.rcptPbctDt ?? '',
        qrCodeUrl: d.qrCodeUrl,
        raw,
      };
    },
  );
}

export async function selectCodes(
  input: SelectCodesInput,
): Promise<SelectCodesResult> {
  return postWithRetry(
    `${input.baseUrl}/selectCodeList`,
    { codeType: input.codeType, lastReqDt: '20260101000000' },
    { tin: input.tin, bhfId: input.bhfId, cmcKey: input.cmcKey },
    (raw) => {
      const r = raw as {
        resultCd?: string;
        data?: { clsList?: Record<string, Array<{ cd: string; nm: string }>> };
      };
      if (r.resultCd !== '000') {
        throw new EtimsApiError(
          `code list rejected: ${r.resultCd ?? 'unknown'}`,
          'kra_reject',
          r.resultCd,
        );
      }
      if (!r.data?.clsList) {
        throw new EtimsApiError('clsList missing', 'invalid_response');
      }
      return { clsList: r.data.clsList, raw };
    },
  );
}
