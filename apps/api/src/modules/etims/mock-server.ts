// Patch 008B: In-process mock of the KRA OSCU API.
// Used by tests and local dev only — never imported by app.ts or any route.
// Starts on an ephemeral port bound to 127.0.0.1 so multiple tests can run in parallel.
import Fastify from 'fastify';

export interface MockEtimsServer {
  url: string;
  close: () => Promise<void>;
}

const SEQ_START = 1;

export async function startMockEtimsServer(): Promise<MockEtimsServer> {
  const app = Fastify({ logger: false });

  let invcSeq = SEQ_START;
  let rcptSeq = SEQ_START;

  const received: Array<{
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
  }> = [];

  app.addHook('onRequest', async (req) => {
    received.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
    });
  });

  // Init handshake — the only route that does NOT require cmcKey header.
  app.post('/selectInitOsdcInfo', async (req, reply) => {
    const body = req.body as
      | { tin?: string; bhfId?: string; dvcSrlNo?: string }
      | undefined;
    if (!body?.tin || !body?.bhfId || !body?.dvcSrlNo) {
      return reply.send({
        resultCd: '100',
        resultMsg: 'Invalid request',
        resultDt: '20260101000000',
      });
    }
    const cmcKey = `MOCK-CMC-${body.tin}-${body.bhfId}-${body.dvcSrlNo}`;
    return reply.send({
      resultCd: '000',
      resultMsg: 'It is succeeded',
      resultDt: '20260101000000',
      data: { cmcKey },
    });
  });

  // Save sale — requires tin, bhfId, cmcKey headers.
  app.post('/saveTrnsSalesOsdc', async (req, reply) => {
    const tin = req.headers['tin'] as string | undefined;
    const bhfId = req.headers['bhfid'] as string | undefined;
    const cmcKey = req.headers['cmckey'] as string | undefined;

    if (!tin || !bhfId || !cmcKey) {
      return reply.send({
        resultCd: '200',
        resultMsg: 'Missing auth headers (tin, bhfId, cmcKey)',
        resultDt: '20260101000000',
      });
    }

    const body = req.body as { invcNo?: number; totAmt?: number } | undefined;
    if (!body || typeof body.invcNo !== 'number') {
      return reply.send({
        resultCd: '100',
        resultMsg: 'Invalid payload — invcNo required',
        resultDt: '20260101000000',
      });
    }

    invcSeq = Math.max(invcSeq, body.invcNo);
    const rcptNo = rcptSeq++;

    return reply.send({
      resultCd: '000',
      resultMsg: 'It is succeeded',
      resultDt: '20260101000000',
      data: {
        curRcptNo: rcptNo,
        totRcptNo: rcptNo,
        intrlData: `MOCK-INTRL-${body.invcNo}-${rcptNo}`,
        rcptSign: `MOCK-SIGN-${body.invcNo}-${rcptNo}`,
        rcptPbctDt: '20260101000000',
        qrCodeUrl: `https://mock.kra.go.ke/qr/${body.invcNo}`,
      },
    });
  });

  // Code lists
  app.post('/selectCodeList', async (req, reply) => {
    const body = req.body as { codeType?: string; lastReqDt?: string } | undefined;
    const codeType = body?.codeType ?? 'all';

    const codes: Record<string, Array<{ cd: string; nm: string }>> = {
      taxTyCd: [
        { cd: 'A', nm: 'Exempt' },
        { cd: 'B', nm: 'VAT 16%' },
        { cd: 'C', nm: 'Zero rated' },
        { cd: 'D', nm: 'Non-VAT' },
        { cd: 'E', nm: 'VAT 8%' },
      ],
      pmtTyCd: [
        { cd: '01', nm: 'Cash' },
        { cd: '02', nm: 'Credit' },
        { cd: '03', nm: 'M-Pesa' },
        { cd: '04', nm: 'Card' },
      ],
    };

    return reply.send({
      resultCd: '000',
      resultMsg: 'It is succeeded',
      resultDt: '20260101000000',
      data: {
        clsList: codeType === 'all' ? codes : { [codeType]: codes[codeType] ?? [] },
      },
    });
  });

  // Debug endpoint — returns all requests received so tests can assert headers/body.
  app.get('/__debug/echo', async (_req, reply) => {
    return reply.send({ count: received.length, requests: received });
  });

  // Health
  app.get('/__debug/health', async (_req, reply) => reply.send({ ok: true }));

  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') {
    await app.close();
    throw new Error('mock_etims_server_failed_to_bind');
  }
  const url = `http://127.0.0.1:${addr.port}`;

  return {
    url,
    close: async () => {
      await app.close();
    },
  };
}
