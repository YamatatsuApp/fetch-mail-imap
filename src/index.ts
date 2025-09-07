import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { ImapFlow, type ImapFlowOptions } from 'imapflow';
import { simpleParser } from 'mailparser';

type PostData = {
  client: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };
  range: [string, string] | string;
  uid: boolean;
};

const app = new Hono();

app.post('/', async (c) => {
  console.log('start');

  const postData = (await c.req.json()) as PostData;

  const config = { ...postData.client, ...{ logger: false } } as ImapFlowOptions;
  const _range = postData.range;
  const range = Array.isArray(_range) ? _range.join(':') : _range + ':' + _range;
  console.log('range ', range);
  const isUid = postData.uid;
  console.log('isUid ', isUid);
  const client = new ImapFlow(config);

  let lock;
  try {
    await client.connect();
    console.log('connection end');
    lock = await client.getMailboxLock('INBOX');

    const messages = await client.fetchAll(range, { uid: true, envelope: true }, { uid: isUid });
    console.log('client.fetch end messages.length ', messages.length);
    console.log(
      'uids',
      messages.map((m) => m.uid.toString())
    );
    const inquiries = [] as {
      uid: string;
      from: string;
      to: string;
      receivedAt: string | null;
      subject: string;
      message: string;
    }[];
    for (const message of messages) {
      const uid = message.uid.toString();
      const from = message.envelope?.from || [{ address: 'unknown' }];
      const to = message.envelope?.to || [{ address: 'unknown' }];
      const date = message.envelope?.date;
      console.log('uid ', uid);
      console.log('client.download start');
      const { content } = await client.download(uid, '', { uid: true });
      console.log('client.download end');
      const mailBody = await simpleParser(content);
      const inquiry = {
        uid: uid,
        from: from[0].address as string,
        to: to[0].address as string,
        receivedAt: date ? date.toJSON() : null,
        subject: message.envelope?.subject || '不明',
        message: mailBody.text as string,
      };
      inquiries.push(inquiry);
    }
    console.log('end inquiries.length ', inquiries.length);

    return c.json({ isSuccess: true, values: inquiries });
  } catch (error) {
    console.error('Error fetching emails:', error);
    let errorMessage = '';
    if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = 'An unknown error occurred';
    }
    return c.json({ isSuccess: false, explanation: errorMessage });
  } finally {
    if (lock) lock.release();
    await client.logout();
    console.log('finally end');
  }
});

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  }
);

/*
curl  POST http://localhost:3000/ -H "Content-Type: application/json" -d '{"client":{"host":"imap.lolipop.jp","port":993,"secure":true,"auth":{"user":"hankyou@sykh.co.jp","pass":"Ha0000-sy2473"}},"range":["1","10"],"uid":true}'

*/
