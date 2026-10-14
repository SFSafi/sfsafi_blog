import { test, expect } from '@playwright/test';
import { Miniflare } from 'miniflare';
import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  createHmac,
} from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const bot = 'https://bot.test',
  site = 'https://site.test',
  appSecret = 'test-qq-app-secret-for-fixture-only',
  siteSecret = 'test-site-integration-secret-over-32-characters';
function privateKey() {
  let seed = Buffer.from(appSecret);
  while (seed.length < 32) seed = Buffer.concat([seed, seed]);
  return createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      seed.subarray(0, 32),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
}
function qqRequest(payload: unknown, invalid = false) {
  const raw = JSON.stringify(payload),
    stamp = String(Math.floor(Date.now() / 1000));
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature-Timestamp': stamp,
      'X-Signature-Ed25519': invalid
        ? '0'.repeat(128)
        : sign(null, Buffer.from(stamp + raw), privateKey()).toString('hex'),
    },
    body: raw,
  };
}
function siteRequest(payload: unknown, invalid = false) {
  const raw = JSON.stringify(payload),
    stamp = String(Math.floor(Date.now() / 1000));
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Space-Timestamp': stamp,
      'X-Space-Signature': invalid
        ? '0'.repeat(64)
        : createHmac('sha256', siteSecret)
            .update(stamp + '.' + raw)
            .digest('hex'),
    },
    body: raw,
  };
}
test('QQ Bot：Ed25519/HMAC、群授权/个人订阅、双渠道持久投递、重启去重及退订', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sfsafi-bot-'));
  let sent = 0;
  const sends: any[] = [];
  const outboundService = async (request: any) => {
    if (request.url.startsWith(site + '/posts/'))
      return new Response('<article data-post-revision="2">public</article>');
    if (request.url === 'https://api.bot.qq.com/app/getAppAccessToken') {
      const body = await request.json();
      expect(body.appId).toBe('test-app');
      expect(body.clientSecret).toBe(appSecret);
      return Response.json({
        access_token: 'fixture-access-token',
        expires_in: 3600,
      });
    }
    if (request.url.startsWith('https://api.bot.qq.com/v2/')) {
      expect(request.headers.get('Authorization')).toBe(
        'QQBot fixture-access-token',
      );
      const body = await request.json();
      expect(body.msg_type).toBe(0);
      if (!body.msg_id) {
        sent++;
        sends.push({ url: request.url, body });
      }
      return Response.json({ id: 'qq-message-' + sent });
    }
    throw Error('Unexpected fixture network');
  };
  const options = {
    script: readFileSync('/tmp/sfsafi-bot-bundle/worker.js', 'utf8'),
    modules: true,
    compatibilityDate: '2026-06-01',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'bot' },
    d1Persist: dir,
    bindings: {
      QQ_APP_ID: 'test-app',
      QQ_APP_SECRET: appSecret,
      QQ_SITE_SECRET: siteSecret,
      SITE_URL: site,
      QQ_GROUP_IDS: 'allowed-group',
      QQ_GROUP_OPERATOR_IDS: 'group-owner',
    },
    outboundService,
  };
  let mf = new Miniflare(options);
  try {
    expect(
      (await mf.dispatchFetch(bot + '/qq/events', qqRequest({ op: 0 }, true)))
        .status,
    ).toBe(401);
    const challenge = await mf.dispatchFetch(
      bot + '/qq/events',
      qqRequest({
        op: 13,
        d: { plain_token: 'test-challenge', event_ts: '12345' },
      }),
    );
    expect(challenge.status).toBe(200);
    const proof = (await challenge.json()) as any;
    expect(
      verify(
        null,
        Buffer.from('12345test-challenge'),
        createPublicKey(privateKey()),
        Buffer.from(proof.signature, 'hex'),
      ),
    ).toBe(true);
    const native = (
      id: string,
      type: string,
      actor: string,
      target: string,
      content = '订阅',
    ) => ({
      op: 0,
      id,
      t: type,
      d: {
        content,
        timestamp: new Date().toISOString(),
        ...(type === 'GROUP_AT_MESSAGE_CREATE'
          ? { group_openid: target, author: { member_openid: actor } }
          : { author: { user_openid: actor } }),
      },
    });
    await mf.dispatchFetch(
      bot + '/qq/events',
      qqRequest(
        native(
          'bad-group-event',
          'GROUP_AT_MESSAGE_CREATE',
          'not-authorized',
          'allowed-group',
        ),
      ),
    );
    await mf.dispatchFetch(
      bot + '/qq/events',
      qqRequest(
        native(
          'group-event',
          'GROUP_AT_MESSAGE_CREATE',
          'group-owner',
          'allowed-group',
        ),
      ),
    );
    await mf.dispatchFetch(
      bot + '/qq/events',
      qqRequest(
        native(
          'user-event',
          'C2C_MESSAGE_CREATE',
          'personal-reader',
          'personal-reader',
        ),
      ),
    );
    const db = await mf.getD1Database('DB');
    await expect
      .poll(async () =>
        Number(
          (
            (await db
              .prepare(
                "SELECT count(*) AS count FROM qq_subscriptions WHERE status='active'",
              )
              .first()) as any
          )?.count,
        ),
      )
      .toBe(2);
    const id = 'post-' + crypto.randomUUID(),
      event = {
        eventId: 'first-published:' + id,
        postId: id,
        revision: 2,
        eventType: 'first_published',
        occurredAt: new Date().toISOString(),
        title: '测试更新',
        excerpt: '公开摘要',
        tags: ['日常'],
        url: site + '/posts/' + id + '/',
      };
    expect(
      (await mf.dispatchFetch(bot + '/site-updates', siteRequest(event, true)))
        .status,
    ).toBe(401);
    expect(
      (
        await mf.dispatchFetch(
          bot + '/site-updates',
          siteRequest({ ...event, url: 'https://evil.test/posts/' + id + '/' }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await mf.dispatchFetch(bot + '/site-updates', siteRequest(event)))
        .status,
    ).toBe(200);
    await expect
      .poll(async () =>
        Number(
          (
            (await db
              .prepare(
                "SELECT count(*) AS count FROM qq_deliveries WHERE state='sent'",
              )
              .first()) as any
          )?.count,
        ),
      )
      .toBe(2);
    expect(sent).toBe(2);
    expect(sends.map((s) => s.url).sort()).toEqual([
      'https://api.bot.qq.com/v2/groups/allowed-group/messages',
      'https://api.bot.qq.com/v2/users/personal-reader/messages',
    ]);
    await mf.dispose();
    mf = new Miniflare(options);
    await mf.dispatchFetch(bot + '/site-updates', siteRequest(event));
    const db2 = await mf.getD1Database('DB');
    expect(
      (
        (await db2
          .prepare('SELECT count(*) AS count FROM qq_events')
          .first()) as any
      ).count,
    ).toBe(1);
    expect(
      (
        (await db2
          .prepare('SELECT count(*) AS count FROM qq_deliveries')
          .first()) as any
      ).count,
    ).toBe(2);
    expect(sent).toBe(2);
    await mf.dispatchFetch(
      bot + '/qq/events',
      qqRequest(
        native(
          'unsubscribe-event',
          'C2C_MESSAGE_CREATE',
          'personal-reader',
          'personal-reader',
          '退订',
        ),
      ),
    );
    await expect
      .poll(async () =>
        String(
          (
            (await db2
              .prepare(
                "SELECT status FROM qq_subscriptions WHERE id='user:personal-reader'",
              )
              .first()) as any
          )?.status,
        ),
      )
      .toBe('unsubscribed');
    const next = 'post-' + crypto.randomUUID();
    await mf.dispatchFetch(
      bot + '/site-updates',
      siteRequest({
        ...event,
        eventId: 'first-published:' + next,
        postId: next,
        url: site + '/posts/' + next + '/',
        occurredAt: new Date().toISOString(),
      }),
    );
    await expect.poll(() => sent).toBe(3);
  } finally {
    await mf.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('QQ Bot：撤回阻止投递、失败不伪装发送成功', async () => {
  let unavailable = false;
  const options = {
    script: readFileSync('/tmp/sfsafi-bot-bundle/worker.js', 'utf8'),
    modules: true,
    compatibilityDate: '2026-06-01',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'bot' },
    bindings: {
      QQ_APP_ID: 'test-app',
      QQ_APP_SECRET: appSecret,
      QQ_SITE_SECRET: siteSecret,
      SITE_URL: site,
    },
    outboundService: async (request: any) =>
      request.url.startsWith(site)
        ? new Response('Not found', { status: unavailable ? 503 : 404 })
        : Response.json({
            access_token: 'fixture-access-token',
            expires_in: 3600,
          }),
  };
  const mf = new Miniflare(options);
  try {
    await mf.dispatchFetch(
      bot + '/qq/events',
      qqRequest({
        op: 0,
        id: 'subscribe',
        t: 'C2C_MESSAGE_CREATE',
        d: {
          author: { user_openid: 'reader' },
          content: '订阅',
          timestamp: new Date().toISOString(),
        },
      }),
    );
    const db = await mf.getD1Database('DB');
    await expect
      .poll(async () =>
        Number(
          (
            (await db
              .prepare('SELECT count(*) AS count FROM qq_subscriptions')
              .first()) as any
          ).count,
        ),
      )
      .toBe(1);
    const create = () => {
      const id = 'post-' + crypto.randomUUID();
      return {
        eventId: 'first-published:' + id,
        postId: id,
        revision: 2,
        eventType: 'first_published',
        occurredAt: new Date().toISOString(),
        title: '更新',
        excerpt: '摘要',
        tags: [],
        url: site + '/posts/' + id + '/',
      };
    };
    const withdrawn = create();
    await mf.dispatchFetch(bot + '/site-updates', siteRequest(withdrawn));
    await expect
      .poll(async () =>
        String(
          (
            (await db
              .prepare('SELECT state FROM qq_deliveries WHERE event_id=?')
              .bind(withdrawn.eventId)
              .first()) as any
          )?.state,
        ),
      )
      .toBe('cancelled');
    unavailable = true;
    const retry = create();
    await mf.dispatchFetch(bot + '/site-updates', siteRequest(retry));
    await expect
      .poll(async () =>
        Number(
          (
            (await db
              .prepare('SELECT attempts FROM qq_deliveries WHERE event_id=?')
              .bind(retry.eventId)
              .first()) as any
          )?.attempts,
        ),
      )
      .toBe(1);
    expect(
      (
        (await db
          .prepare('SELECT state FROM qq_deliveries WHERE event_id=?')
          .bind(retry.eventId)
          .first()) as any
      ).state,
    ).toBe('pending');
  } finally {
    await mf.dispose();
  }
});
