import { ConfigReader } from '@backstage/config';
import { LoggerService } from '@backstage/backend-plugin-api';
import { HcpTfClient, WorkspaceOutput } from './HcpTfClient.ts';

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
} as unknown as LoggerService;

function makeClient(): HcpTfClient {
  const config = new ConfigReader({
    hcpTerraform: { organization: 'test-org', token: 'test-token' },
  });
  return new HcpTfClient(config, noopLogger);
}

describe('HcpTfClient.readOutputsCached', () => {
  const outputs: WorkspaceOutput[] = [
    { key: 'jwt_auth_path', value: 'jwt/cluster', sensitive: false },
  ];

  it('returns [] without an API call when there is no state version', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'readOutputs').mockResolvedValue(outputs);

    await expect(client.readOutputsCached('ws-1', null)).resolves.toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('fetches once and serves repeat reads from cache for an unchanged state version', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'readOutputs').mockResolvedValue(outputs);

    const first = await client.readOutputsCached('ws-1', 'sv-1');
    const second = await client.readOutputsCached('ws-1', 'sv-1');

    expect(first).toEqual(outputs);
    expect(second).toEqual(outputs);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('refetches outputs when the state version changes', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'readOutputs').mockResolvedValue(outputs);

    await client.readOutputsCached('ws-1', 'sv-1');
    await client.readOutputsCached('ws-1', 'sv-2');

    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('HcpTfClient pagination', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function mockFetchPages(pages: any[][], includedPages: any[][] = []) {
    return jest.fn(async (url: string) => {
      const m = /page%5Bnumber%5D=(\d+)/.exec(url);
      const pageNum = m ? Number(m[1]) : 1;
      const data = pages[pageNum - 1] ?? [];
      const included = includedPages[pageNum - 1] ?? [];
      const hasNext = pageNum < pages.length;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          data,
          included,
          meta: { pagination: { 'next-page': hasNext ? pageNum + 1 : null } },
        }),
        text: async () => '',
      } as any;
    });
  }

  it('listWorkspaces follows next-page links instead of truncating at 100', async () => {
    const client = makeClient();
    const mkWs = (i: number) => ({
      id: `ws-${i}`,
      attributes: { name: `ws-${i}`, 'source-module-id': null, 'tag-names': [] },
      relationships: {
        project: { data: { id: 'prj-1' } },
        'current-run': { data: { id: `run-${i}` } },
        'current-state-version': { data: { id: `sv-${i}` } },
      },
    });
    const page1 = Array.from({ length: 100 }, (_, i) => mkWs(i));
    const page2 = [mkWs(100), mkWs(101)];
    const included2 = [{ id: 'run-101', type: 'runs', attributes: { status: 'applied' } }];
    const fetchMock = mockFetchPages([page1, page2], [[], included2]);
    global.fetch = fetchMock as unknown as typeof fetch;

    const ws = await client.listWorkspaces();

    expect(ws).toHaveLength(102);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ws[101].id).toBe('ws-101');
    expect(ws[101].currentStateVersionId).toBe('sv-101');
    // Status resolved from the sideloaded current_run include.
    expect(ws[101].status).toBe('applied');
    // No matching included run -> falls back to 'unknown' (not a crash).
    expect(ws[0].status).toBe('unknown');
  });
});

describe('HcpTfClient retry backoff', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  it('caps a server-supplied Retry-After at 30 seconds', async () => {
    jest.useFakeTimers();
    const client = makeClient();
    const rateLimited = {
      ok: false,
      status: 429,
      headers: { get: (h: string) => (h === 'retry-after' ? '3600' : null) },
      json: async () => ({}),
      text: async () => 'rate limited',
    };
    const success = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ data: [], meta: { pagination: { 'next-page': null } } }),
      text: async () => '',
    };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(rateLimited)
      .mockResolvedValue(success);
    global.fetch = fetchMock as unknown as typeof fetch;

    const promise = client.listWorkspaces();
    await jest.advanceTimersByTimeAsync(30_000);
    // An uncapped Retry-After of 3600s would still be sleeping here.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(promise).resolves.toEqual([]);
  });
});
