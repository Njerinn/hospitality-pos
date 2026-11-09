import { config } from '../../config.js';

let cachedToken: { token: string; expiresAt: number } | null = null;

function baseUrl(): string {
  return config.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const basic = Buffer.from(
    `${config.MPESA_CONSUMER_KEY}:${config.MPESA_CONSUMER_SECRET}`,
  ).toString('base64');
  const res = await fetch(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!res.ok) throw new Error(`mpesa oauth failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in: string };
  cachedToken = {
    token: body.access_token,
    expiresAt: Date.now() + Number(body.expires_in) * 1000,
  };
  return body.access_token;
}

export async function registerC2BUrls(): Promise<{ status: number; body: unknown }> {
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}/mpesa/c2b/v1/registerurl`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      ShortCode: config.MPESA_TILL_NUMBER,
      ResponseType: 'Completed',
      ConfirmationURL: config.MPESA_CONFIRMATION_URL,
      ValidationURL: config.MPESA_VALIDATION_URL,
    }),
  });
  return { status: res.status, body: await res.json() };
}

export async function simulateC2B(input: {
  msisdn: string;
  amount: number;
  billRef: string;
}): Promise<{ status: number; body: unknown }> {
  if (config.MPESA_ENV !== 'sandbox') throw new Error('simulateC2B only available in sandbox');
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}/mpesa/c2b/v1/simulate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      ShortCode: config.MPESA_TILL_NUMBER,
      CommandID: 'CustomerBuyGoodsOnline',
      Amount: input.amount,
      Msisdn: input.msisdn,
      BillRefNumber: input.billRef,
    }),
  });
  return { status: res.status, body: await res.json() };
}
