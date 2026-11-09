import { Logger } from '@nestjs/common';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotService, type TableLookup } from '../../src/bot/bot.service.js';
import { TelegramConfig } from '../../src/telegram/config.js';
import { TELEGRAM_ON, TEST_BOT_USERNAME, TEST_LINK } from '../helpers/bot-env.js';
import { FakeBotApi } from '../helpers/fake-bot-api.js';

/**
 * PLAN §19.8, Stage 10 acceptance 9. Every word is copied from §19.8 by hand, so a change in
 * `bot/words.ts` cannot pass silently.
 */

const CHAT = 1001;
const GROUP = -1_001_234_567_890;
const USER = 777;

const WELCOME = 'Welcome to RB Poker Coach. Learn poker by playing. Free, play money only.';
const JOIN = 'Tap to join the table.';
const NEW_TABLE = 'Tap to open the game and make a table.';
const HELP =
  'Open the game with the Play button. Play with friends: make a table and send the link. Play money only. Chips have no value.';
const PITCH = "Play Texas Hold'em and learn while you play. Free, play money only.";

/** Command, words, button text, button link. */
const COMMANDS: ReadonlyArray<readonly [string, string, string, string]> = [
  ['/start', WELCOME, 'Play', TEST_LINK],
  ['/start ABCD2345', JOIN, 'Join table', `${TEST_LINK}?startapp=ABCD2345`],
  ['/start new', NEW_TABLE, 'New table', `${TEST_LINK}?startapp=new`],
  ['/new', NEW_TABLE, 'New table', `${TEST_LINK}?startapp=new`],
  ['/help', HELP, 'Play', TEST_LINK],
  ['/post', `${PITCH} ${TEST_LINK}`, 'Play', TEST_LINK],
];

function expectedReply(chatId: number, text: string, button: string, url: string) {
  return {
    method: 'sendMessage',
    params: { chat_id: chatId, text, reply_markup: { inline_keyboard: [[{ text: button, url }]] } },
  };
}

describe('BotService', () => {
  let api: FakeBotApi;
  let lookup: { codeOfUser: Mock<TableLookup['codeOfUser']> };
  let service: BotService;
  let nextUpdateId: number;

  const message = (text: unknown, chatId: unknown = CHAT) => ({
    update_id: nextUpdateId++,
    message: {
      message_id: 5,
      date: 1_762_646_400,
      from: { id: USER, is_bot: false, first_name: 'Ann' },
      chat: { id: chatId, type: 'private' },
      text,
    },
  });

  const inlineQuery = (query = '') => ({
    update_id: nextUpdateId++,
    inline_query: {
      id: 'query-1',
      from: { id: USER, is_bot: false, first_name: 'Ann' },
      query,
      offset: '',
    },
  });

  beforeEach(() => {
    api = new FakeBotApi();
    lookup = { codeOfUser: vi.fn<TableLookup['codeOfUser']>(() => null) };
    service = new BotService(new TelegramConfig(TELEGRAM_ON), api, lookup);
    nextUpdateId = 1;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('commands', () => {
    it.each(COMMANDS)('%s in a private chat gets exactly the §19.8 reply', async (...row) => {
      const [text, words, button, url] = row;

      await service.handleUpdate(message(text));

      expect(api.calls).toEqual([expectedReply(CHAT, words, button, url)]);
    });

    it.each(COMMANDS)('%s, named for this bot, in a group', async (...row) => {
      const [text, words, button, url] = row;
      const named = text.replace(/^\/\w+/, (command) => `${command}@${TEST_BOT_USERNAME}`);

      await service.handleUpdate(message(named, GROUP));

      expect(api.calls).toEqual([expectedReply(GROUP, words, button, url)]);
    });

    it('takes a plain /new in a group, which names no bot', async () => {
      await service.handleUpdate(message('/new', GROUP));

      expect(api.calls).toEqual([
        expectedReply(GROUP, NEW_TABLE, 'New table', `${TEST_LINK}?startapp=new`),
      ]);
    });

    it('reads a username in any case: Telegram does', async () => {
      await service.handleUpdate(message('/help@RB_Poker_TEST_Bot'));

      expect(api.methods()).toEqual(['sendMessage']);
    });

    it.each(['/new@other_bot', '/start@other_bot ABCD2345', '/help@other', '/post@rb_poker'])(
      'leaves %s alone: it names another bot',
      async (text) => {
        await service.handleUpdate(message(text, GROUP));

        expect(api.calls).toEqual([]);
      },
    );

    it.each([
      'hello',
      'new',
      ' /new',
      'please /new',
      '/',
      '/@rb_poker_test_bot',
      '/unknown',
      `/${'a'.repeat(33)}`,
      '',
    ])('says nothing to %j', async (text) => {
      await service.handleUpdate(message(text));

      expect(api.calls).toEqual([]);
    });

    it.each(['23456789', 'ABCDEFGH', 'JKMNPQRS', 'TUVWXYZ2'])(
      'takes /start %s: 8 characters of the 31-letter alphabet',
      async (code) => {
        await service.handleUpdate(message(`/start ${code}`));

        expect(api.calls).toEqual([
          expectedReply(CHAT, JOIN, 'Join table', `${TEST_LINK}?startapp=${code}`),
        ]);
      },
    );

    it.each([
      'ABCD234',
      'ABCD23456',
      'abcd2345',
      'ABCD2340',
      'ABCDEFGO',
      'ABCDEFG1',
      'ABCDEFGI',
      'ABCDEFGL',
      'ABCD2345 more',
      '../../evil',
      'ABCD2345&x=1',
      'NEW',
    ])('/start %s is not a code, so it is the welcome and goes in no link', async (param) => {
      await service.handleUpdate(message(`/start ${param}`));

      expect(api.calls).toEqual([expectedReply(CHAT, WELCOME, 'Play', TEST_LINK)]);
    });

    it('sends only URL buttons, the kind that works in groups and channels (§19.2)', async () => {
      for (const [text] of COMMANDS) await service.handleUpdate(message(text));

      expect(api.calls).toHaveLength(COMMANDS.length);
      expect(JSON.stringify(api.calls)).not.toContain('web_app');
    });
  });

  describe('inline mode', () => {
    const results = () => api.calls[0]?.params.results;

    it('not at a table: one "Play" result, personal and never cached', async () => {
      await service.handleUpdate(inlineQuery());

      expect(api.calls).toEqual([
        {
          method: 'answerInlineQuery',
          params: {
            inline_query_id: 'query-1',
            cache_time: 0,
            is_personal: true,
            results: [
              {
                type: 'article',
                id: 'play',
                title: 'Play RB Poker Coach',
                description: 'Free. Play money only.',
                input_message_content: { message_text: PITCH },
                reply_markup: { inline_keyboard: [[{ text: 'Play', url: TEST_LINK }]] },
              },
            ],
          },
        },
      ]);
    });

    it('at a table: one invitation to that table', async () => {
      lookup.codeOfUser.mockReturnValue('ABCD2345');

      await service.handleUpdate(inlineQuery());

      expect(api.calls).toEqual([
        {
          method: 'answerInlineQuery',
          params: {
            inline_query_id: 'query-1',
            cache_time: 0,
            is_personal: true,
            results: [
              {
                type: 'article',
                id: 'table',
                title: 'Invite to my poker table',
                description: 'Friends tap the button to join.',
                input_message_content: { message_text: 'Join my poker table! Play money only.' },
                reply_markup: {
                  inline_keyboard: [
                    [{ text: 'Join table', url: `${TEST_LINK}?startapp=ABCD2345` }],
                  ],
                },
              },
            ],
          },
        },
      ]);
    });

    it('asks about the user who typed it', async () => {
      await service.handleUpdate(inlineQuery());

      expect(lookup.codeOfUser).toHaveBeenCalledExactlyOnceWith(USER);
    });

    it.each(['', 'anything at all', '/new'])('gives one result for %j', async (query) => {
      await service.handleUpdate(inlineQuery(query));

      expect(results()).toHaveLength(1);
    });
  });

  describe('a repeated update_id', () => {
    it('is answered once', async () => {
      const update = message('/help');

      await service.handleUpdate(update);
      await service.handleUpdate(update);
      await service.handleUpdate(update);

      expect(api.calls).toHaveLength(1);
    });

    it('counts for inline queries too', async () => {
      const update = inlineQuery();

      await service.handleUpdate(update);
      await service.handleUpdate(update);

      expect(api.calls).toHaveLength(1);
    });

    it('is remembered for the last 1,000 updates and no longer', async () => {
      const update = (id: number) => ({ ...message('/help'), update_id: id });
      for (let id = 1; id <= 1_000; id += 1) await service.handleUpdate(update(id));
      expect(api.calls).toHaveLength(1_000);

      await service.handleUpdate(update(1));
      expect(api.calls).toHaveLength(1_000); // Still among the last 1,000.

      await service.handleUpdate(update(1_001));
      expect(api.calls).toHaveLength(1_001); // That pushes the oldest, 1, out.

      await service.handleUpdate(update(2));
      expect(api.calls).toHaveLength(1_001); // 2 is still remembered.

      await service.handleUpdate(update(1));
      expect(api.calls).toHaveLength(1_002); // 1 is forgotten: answered like a new one.
    });
  });

  describe('updates that are not what we expect', () => {
    it.each([
      ['nothing', undefined],
      ['null', null],
      ['a string', 'x'],
      ['an empty object', {}],
      ['no update_id', { message: { chat: { id: 1 }, text: '/new' } }],
      ['an update_id as text', { update_id: '1', message: { chat: { id: 1 }, text: '/new' } }],
      ['a message without a chat', { update_id: 1, message: { text: '/new' } }],
      ['a chat without an id', { update_id: 1, message: { chat: {}, text: '/new' } }],
      ['a chat id as text', { update_id: 1, message: { chat: { id: '1' }, text: '/new' } }],
      ['a message that is not an object', { update_id: 1, message: 5 }],
      ['a message with no text (a photo)', { update_id: 1, message: { chat: { id: 1 } } }],
      ['an inline query with no id', { update_id: 1, inline_query: { from: { id: 1 } } }],
      ['an inline query with no user', { update_id: 1, inline_query: { id: 'x' } }],
      ['a kind we did not ask for', { update_id: 1, edited_message: { chat: { id: 1 } } }],
    ])('ignores %s', async (_name, update) => {
      await expect(service.handleUpdate(update)).resolves.toBeUndefined();

      expect(api.calls).toEqual([]);
      expect(service.failures).toBe(0);
    });
  });

  describe('a failing Telegram API', () => {
    it('is counted, never thrown', async () => {
      api.respond = () => Promise.reject(new Error('Telegram is down'));

      await expect(service.handleUpdate(message('/help'))).resolves.toBeUndefined();
      await expect(service.handleUpdate(inlineQuery())).resolves.toBeUndefined();

      expect(service.failures).toBe(2);
    });

    it('survives a call that throws at once, not only one that rejects', async () => {
      api.respond = () => {
        throw new Error('boom');
      };

      await expect(service.handleUpdate(message('/help'))).resolves.toBeUndefined();

      expect(service.failures).toBe(1);
    });

    it('survives a table lookup that throws', async () => {
      lookup.codeOfUser.mockImplementation(() => {
        throw new Error('boom');
      });

      await expect(service.handleUpdate(inlineQuery())).resolves.toBeUndefined();

      expect(service.failures).toBe(1);
    });

    it('does not stop the next update being answered', async () => {
      api.respond = () => Promise.reject(new Error('Telegram is down'));
      await service.handleUpdate(message('/help'));

      api.respond = () => Promise.resolve();
      await service.handleUpdate(message('/new'));

      expect(api.calls).toHaveLength(2);
      expect(service.failures).toBe(1);
    });
  });

  it('logs nothing about anyone (§19.9)', async () => {
    const logged = [
      ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m)),
      ...(['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const).map((m) =>
        vi.spyOn(Logger.prototype, m),
      ),
    ];

    await service.handleUpdate(message('/help'));
    await service.handleUpdate(inlineQuery());
    api.respond = () => Promise.reject(new Error('Telegram is down'));
    await service.handleUpdate(message('/new'));

    for (const spy of logged) expect(spy).not.toHaveBeenCalled();
  });
});
