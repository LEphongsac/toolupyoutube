#!/usr/bin/env node
// Upload a video to your own YouTube channel.
// Usage: node upload.js <video-file> --title "..." [options]   (see --help)

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { exec } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];
const PRIVACY = ['private', 'unlisted', 'public'];

const HELP = `
Upload a video to your YouTube channel.

Usage:
  node upload.js <video-file> --title "My title" [options]

Options:
  -t, --title <text>          Video title (required, max 100 chars)
  -d, --description <text>    Description
      --description-file <f>  Read the description from a text file
      --tags <a,b,c>          Comma-separated tags
  -p, --privacy <value>       private | unlisted | public   (default: private)
      --publish-at <date>     Schedule publishing, e.g. 2026-11-01T18:00:00+07:00
                              (the video stays private until then)
      --category <id>         YouTube category id (default: 22 = People & Blogs)
      --for-kids              Mark the video as made for kids
      --client-secret <f>     OAuth client file (default: client_secret.json)
      --token <f>             Saved login file (default: token.json)
  -h, --help                  Show this help

The first run opens your browser so you can sign in to Google and allow access.
The login is then saved in token.json, so later runs do not ask again.
`;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function readOptions() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        title: { type: 'string', short: 't' },
        description: { type: 'string', short: 'd', default: '' },
        'description-file': { type: 'string' },
        tags: { type: 'string', default: '' },
        privacy: { type: 'string', short: 'p', default: 'private' },
        'publish-at': { type: 'string' },
        category: { type: 'string', default: '22' },
        'for-kids': { type: 'boolean', default: false },
        'client-secret': { type: 'string', default: path.join(HERE, 'client_secret.json') },
        token: { type: 'string', default: path.join(HERE, 'token.json') },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    fail(`${err.message}\n${HELP}`);
  }

  const { values, positionals } = parsed;
  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const file = positionals[0];
  if (!file) fail(`missing video file.\n${HELP}`);
  if (!fs.existsSync(file)) fail(`video file not found: ${file}`);
  if (!values.title) fail('missing --title');
  if (values.title.length > 100) fail('title is longer than 100 characters');
  if (!PRIVACY.includes(values.privacy)) fail(`--privacy must be one of: ${PRIVACY.join(', ')}`);

  let description = values.description;
  if (values['description-file']) {
    description = fs.readFileSync(values['description-file'], 'utf8');
  }

  let publishAt;
  if (values['publish-at']) {
    const date = new Date(values['publish-at']);
    if (Number.isNaN(date.getTime())) fail(`invalid --publish-at date: ${values['publish-at']}`);
    if (date <= new Date()) fail('--publish-at must be in the future');
    publishAt = date.toISOString();
  }

  return {
    file,
    title: values.title,
    description,
    tags: values.tags.split(',').map((t) => t.trim()).filter(Boolean),
    // YouTube requires scheduled videos to be private until the publish time.
    privacy: publishAt ? 'private' : values.privacy,
    publishAt,
    category: values.category,
    forKids: values['for-kids'],
    clientSecretPath: values['client-secret'],
    tokenPath: values.token,
  };
}

function openBrowser(url) {
  const command =
    process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(command, () => {});
}

// Sign in through the browser: Google redirects back to a small local server
// with a one-time code, which we swap for tokens.
function signInWithBrowser(clientId, clientSecret) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}`;
      const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: SCOPES,
      });

      server.on('request', async (req, res) => {
        const params = new URL(req.url, redirectUri).searchParams;
        const code = params.get('code');
        const error = params.get('error');
        if (!code && !error) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(error
          ? '<h2>Sign-in was cancelled. You can close this tab.</h2>'
          : '<h2>Signed in. You can close this tab and go back to the terminal.</h2>');
        server.close();

        if (error) {
          reject(new Error(`Google sign-in failed: ${error}`));
          return;
        }
        try {
          const { tokens } = await client.getToken(code);
          client.setCredentials(tokens);
          resolve(client);
        } catch (err) {
          reject(err);
        }
      });

      console.log('Opening your browser to sign in to Google...');
      console.log(`If it does not open, copy this link into your browser:\n${authUrl}\n`);
      openBrowser(authUrl);
    });
    server.on('error', reject);
  });
}

async function getAuthClient(clientSecretPath, tokenPath) {
  if (!fs.existsSync(clientSecretPath)) {
    fail(`OAuth client file not found: ${clientSecretPath}\n` +
      'Download it from Google Cloud Console > Credentials (type: Desktop app) and save it as client_secret.json.');
  }
  const secrets = JSON.parse(fs.readFileSync(clientSecretPath, 'utf8'));
  const { client_id, client_secret } = secrets.installed || secrets.web || {};
  if (!client_id || !client_secret) fail(`${clientSecretPath} is not a valid OAuth client file`);

  let client;
  if (fs.existsSync(tokenPath)) {
    client = new google.auth.OAuth2(client_id, client_secret);
    client.setCredentials(JSON.parse(fs.readFileSync(tokenPath, 'utf8')));
  } else {
    client = await signInWithBrowser(client_id, client_secret);
    saveToken(tokenPath, client.credentials);
    console.log(`Login saved to ${tokenPath}\n`);
  }

  // Keep token.json current when the access token is refreshed.
  client.on('tokens', (tokens) => saveToken(tokenPath, { ...client.credentials, ...tokens }));
  return client;
}

function saveToken(tokenPath, tokens) {
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

function formatMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function upload(auth, opts) {
  const youtube = google.youtube({ version: 'v3', auth });
  const size = fs.statSync(opts.file).size;

  console.log(`Uploading "${opts.title}" (${formatMB(size)}) as ${opts.privacy}...`);

  const res = await youtube.videos.insert(
    {
      part: ['snippet', 'status'],
      notifySubscribers: true,
      requestBody: {
        snippet: {
          title: opts.title,
          description: opts.description,
          tags: opts.tags,
          categoryId: opts.category,
        },
        status: {
          privacyStatus: opts.privacy,
          publishAt: opts.publishAt,
          selfDeclaredMadeForKids: opts.forKids,
        },
      },
      media: { body: fs.createReadStream(opts.file) },
    },
    {
      onUploadProgress: (evt) => {
        const percent = Math.min(100, Math.round((evt.bytesRead / size) * 100));
        process.stdout.write(`\r  ${percent}%  (${formatMB(evt.bytesRead)} / ${formatMB(size)})`);
      },
    },
  );
  process.stdout.write('\n');
  return res.data;
}

async function main() {
  const opts = readOptions();
  const auth = await getAuthClient(opts.clientSecretPath, opts.tokenPath);

  try {
    const video = await upload(auth, opts);
    console.log('\nDone!');
    console.log(`  Video id: ${video.id}`);
    console.log(`  Link:     https://youtu.be/${video.id}`);
    console.log(`  Privacy:  ${video.status.privacyStatus}`);
    if (video.status.publishAt) console.log(`  Publishes at: ${video.status.publishAt}`);
    if (opts.privacy !== 'private' && video.status.privacyStatus === 'private') {
      console.log('\nNote: YouTube set this video to private. Until your Google Cloud project passes the');
      console.log('YouTube API audit, API uploads are locked to private. Change it in YouTube Studio.');
    }
  } catch (err) {
    process.stdout.write('\n');
    const reason = err.errors?.[0]?.reason || err.response?.data?.error?.errors?.[0]?.reason;
    if (reason === 'quotaExceeded') fail('daily API quota used up. Try again tomorrow.');
    if (reason === 'uploadLimitExceeded') fail('your channel hit its daily upload limit. Try again tomorrow.');
    if (err.message?.includes('invalid_grant')) {
      fail(`your saved login expired or was revoked. Delete ${opts.tokenPath} and run again to sign in.`);
    }
    if (err.message?.includes('invalid_client')) {
      fail(`Google rejected the OAuth client. Download client_secret.json again from Google Cloud Console.`);
    }
    fail(err.message);
  }
}

main();
