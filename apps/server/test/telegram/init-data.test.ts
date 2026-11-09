import { inspect } from 'node:util';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  INIT_DATA_MAX_AGE_SECONDS,
  INIT_DATA_MAX_AHEAD_SECONDS,
  checkInitData,
} from '../../src/telegram/init-data.js';
import { TEST_BOT_TOKEN, signFields, signInitData } from '../helpers/sign-init-data.js';

/** PLAN §19.2, §19.9, Stage 10 acceptance 2. */

const NOW = 1_762_646_400;
const ANN = { ok: true, user: { id: 42, firstName: 'Ann' } };
const good = (): string => signInitData({ authDate: NOW });

/** The string with one field changed (or removed), keeping the original hash. */
function withField(raw: string, key: string, value: string | null): string {
  const params = new URLSearchParams(raw);
  if (value === null) params.delete(key);
  else params.set(key, value);
  return params.toString();
}

const hashOf = (raw: string): string => new URLSearchParams(raw).get('hash') ?? '';
const check = (raw: string, token = TEST_BOT_TOKEN, now = NOW) => checkInitData(raw, token, now);
const refusal = (reason: string) => ({ ok: false, reason });

/** Signed correctly, with `user` as this exact text. */
const signedUser = (user: string): string =>
  signFields({ auth_date: String(NOW), query_id: 'q', user });

describe('checkInitData', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('a correctly signed string', () => {
    it('matches a hash computed with openssl, outside this code base', () => {
      // token "0:KNOWN-ANSWER-test-token", the four fields below sorted by key:
      //   secret=$(printf %s "$token" | openssl dgst -sha256 -hmac WebAppData -binary | xxd -p -c 64)
      //   printf '<check string>' | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$secret"
      const raw = [
        'auth_date=1762646400',
        'query_id=AAHdF6IQAAAAAN0XohDhrOrc',
        'signature=c2lnbmF0dXJl',
        `user=${encodeURIComponent('{"id":279058397,"first_name":"Zoë & Bob = 1+1"}')}`,
        'hash=a880d3400526f3a90cd1382101dc45f08fe954610b0f4c360c61e84ff8dc4440',
      ].join('&');

      expect(check(raw, '0:KNOWN-ANSWER-test-token')).toEqual({
        ok: true,
        user: { id: 279058397, firstName: 'Zoë & Bob = 1+1' },
      });
    });

    it('with a signature field passes and gives the id and first name, and nothing else', () => {
      const raw = signInitData({
        authDate: NOW,
        user: {
          id: 7,
          first_name: 'Ben',
          last_name: 'Stone',
          username: 'ben',
          language_code: 'en',
          photo_url: 'https://t.me/i/userpic/320/x.svg',
        },
      });

      expect(new URLSearchParams(raw).has('signature')).toBe(true);
      expect(check(raw)).toEqual({ ok: true, user: { id: 7, firstName: 'Ben' } });
    });

    it('passes whatever order the fields arrive in: they are sorted by key', () => {
      const raw = good();

      expect(check(raw.split('&').reverse().join('&'))).toEqual(ANN);
    });

    it('sorts by key, not by the whole `key=value` line', () => {
      // "a!" sorts after "a" by key; as lines, "a!=2" comes before "a=1" ('!' < '=').
      const raw = signFields({
        a: '1',
        'a!': '2',
        auth_date: String(NOW),
        user: '{"id":1,"first_name":"A"}',
      });

      expect(check(raw)).toEqual({ ok: true, user: { id: 1, firstName: 'A' } });
    });

    it('reads a space written as + as well as %20: the check string has the decoded value', () => {
      const raw = signInitData({ authDate: NOW, user: { id: 1, first_name: 'Ann Lee' } });

      expect(raw).toContain('Ann%20Lee');
      expect(check(raw.replace('Ann%20Lee', 'Ann+Lee'))).toEqual({
        ok: true,
        user: { id: 1, firstName: 'Ann Lee' },
      });
    });

    it('keeps a first name that is empty: the table names such a player (§19.9)', () => {
      const raw = signInitData({ authDate: NOW, user: { id: 1, first_name: '' } });

      expect(check(raw)).toEqual({ ok: true, user: { id: 1, firstName: '' } });
    });
  });

  describe('is refused', () => {
    it('with a wrong hash', () => {
      const raw = good();
      const flipped = hashOf(raw).replace(/.$/, (c) => (c === '0' ? '1' : '0'));

      expect(check(withField(raw, 'hash', flipped))).toEqual(refusal('bad_hash'));
    });

    it('with a wrong token', () => {
      const raw = signInitData({ authDate: NOW, token: '999:another-bot' });

      expect(check(raw)).toEqual(refusal('bad_hash'));
    });

    it.each([
      ['user', '{"id":43,"first_name":"Ann"}'],
      ['auth_date', String(NOW - 1)],
      ['query_id', 'other'],
      ['signature', 'c2lnbmF0dXJl'],
    ])('when %s is changed', (key, value) => {
      expect(check(withField(good(), key, value))).toEqual(refusal('bad_hash'));
    });

    it('when a field is added', () => {
      expect(check(withField(good(), 'start_param', 'ABCDEFGH'))).toEqual(refusal('bad_hash'));
    });

    it.each(['query_id', 'signature'])('when %s is removed: it is part of the hash', (key) => {
      expect(check(withField(good(), key, null))).toEqual(refusal('bad_hash'));
    });

    it.each([
      ['a field', 'user=x'],
      ['auth_date', 'auth_date=1'],
      ['an unknown field', 'query_id=again'],
    ])('with a duplicate key: %s', (_name, extra) => {
      expect(check(`${good()}&${extra}`)).toEqual(refusal('malformed'));
    });

    it('with a duplicate hash, even the right one twice', () => {
      const raw = good();

      expect(check(`${raw}&hash=${hashOf(raw)}`)).toEqual(refusal('malformed'));
    });

    it.each([
      ['no hash', (raw: string) => withField(raw, 'hash', null)],
      ['an empty hash', (raw: string) => withField(raw, 'hash', '')],
      ['a short hash', (raw: string) => withField(raw, 'hash', hashOf(raw).slice(0, 40))],
      ['a hash that is not hex', (raw: string) => withField(raw, 'hash', 'z'.repeat(64))],
      ['a hash in capitals', (raw: string) => withField(raw, 'hash', hashOf(raw).toUpperCase())],
      ['an empty string', () => ''],
      ['plain text', () => 'hello'],
    ])('as malformed: %s', (_name, make) => {
      expect(check(make(good()))).toEqual(refusal('malformed'));
    });

    it.each([
      ['missing', {}],
      ['not a number', { auth_date: 'soon' }],
      ['negative', { auth_date: '-1' }],
      ['in exponent form', { auth_date: '1e9' }],
      ['empty', { auth_date: '' }],
    ])('as malformed, signed but with an auth_date that is %s', (_name, date) => {
      const raw = signFields({ query_id: 'q', user: '{"id":1,"first_name":"A"}', ...date });

      expect(check(raw)).toEqual(refusal('malformed'));
    });

    it('with no user', () => {
      expect(check(signInitData({ authDate: NOW, user: null }))).toEqual(refusal('no_user'));
    });

    it.each([
      ['not JSON', 'not json'],
      ['null', 'null'],
      ['an array', '[1]'],
      ['a number', '5'],
      ['no id', '{"first_name":"A"}'],
      ['an id as text', '{"id":"1","first_name":"A"}'],
      ['a fractional id', '{"id":1.5,"first_name":"A"}'],
      ['an unsafe id', '{"id":9007199254740992,"first_name":"A"}'],
      ['no first name', '{"id":1}'],
      ['a first name that is a number', '{"id":1,"first_name":5}'],
    ])('with a signed user that is %s', (_name, user) => {
      expect(check(signedUser(user))).toEqual(refusal('no_user'));
    });

    it('with an auth_date older than 24 hours', () => {
      const raw = signInitData({ authDate: NOW - INIT_DATA_MAX_AGE_SECONDS - 1 });

      expect(check(raw)).toEqual(refusal('expired'));
    });

    it('with an auth_date more than 5 minutes ahead', () => {
      const raw = signInitData({ authDate: NOW + INIT_DATA_MAX_AHEAD_SECONDS + 1 });

      expect(check(raw)).toEqual(refusal('ahead'));
    });

    it('for the signature first: nothing in the string is believed before it passes', () => {
      const raw = signInitData({ authDate: NOW - 2 * INIT_DATA_MAX_AGE_SECONDS, token: 'other' });

      expect(check(raw)).toEqual(refusal('bad_hash'));
    });

    it('when the token is empty, even for a string signed with the empty token', () => {
      expect(check(signInitData({ authDate: NOW, token: '' }), '')).toEqual(refusal('bad_hash'));
    });
  });

  describe('the window of auth_date (§19.9)', () => {
    it('is 24 hours behind and 5 minutes ahead', () => {
      expect(INIT_DATA_MAX_AGE_SECONDS).toBe(86_400);
      expect(INIT_DATA_MAX_AHEAD_SECONDS).toBe(300);
    });

    it.each([
      ['now', 0],
      ['exactly 24 hours old', -86_400],
      ['exactly 5 minutes ahead', 300],
    ])('accepts %s', (_name, offset) => {
      expect(check(signInitData({ authDate: NOW + offset }))).toEqual(ANN);
    });
  });

  it('never throws, whatever it is given', () => {
    const pieces = [
      'hash=',
      'user=',
      'auth_date=1',
      '%',
      '%E0%A4%A',
      '%00',
      '&',
      '=',
      '{',
      '"',
      '\u0000',
      '\ud800',
      '😀',
      'a'.repeat(64),
    ];
    let seed = 1;
    const next = (n: number): number => {
      seed = (seed * 48_271) % 2_147_483_647;
      return seed % n;
    };

    for (let i = 0; i < 2_000; i += 1) {
      const raw = Array.from({ length: next(12) }, () => pieces[next(pieces.length)]).join('');

      expect(check(raw).ok).toBe(false);
    }
  });

  it('the token never appears in a result, an error or a log line', () => {
    const logged = [
      ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m)),
      ...(['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const).map((m) =>
        vi.spyOn(Logger.prototype, m),
      ),
    ];
    const raw = good();
    const inputs = [
      raw,
      '',
      'not initData at all',
      `${raw}&user=x`,
      withField(raw, 'hash', '0'.repeat(64)),
      withField(raw, 'hash', null),
      signInitData({ authDate: NOW, user: null }),
      signInitData({ authDate: 1 }),
      signInitData({ authDate: NOW + 100_000 }),
      signedUser('{'),
    ];

    for (const input of inputs) {
      const result = check(input);

      expect(inspect(result, { depth: null })).not.toContain(TEST_BOT_TOKEN);
      expect(JSON.stringify(result)).not.toContain(TEST_BOT_TOKEN);
    }
    for (const spy of logged) expect(spy).not.toHaveBeenCalled();
  });
});
