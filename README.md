# toolupyoutube

A small command-line tool that uploads videos to **your own** YouTube channel with the official YouTube Data API v3.

- Privacy policy: https://lephongsac.github.io/privacy.html
- Terms: https://lephongsac.github.io/terms.html

## Requirements

- Node.js 22.15 or newer
- A Google Cloud project with **YouTube Data API v3** enabled
- An OAuth client ID of type **Desktop app**

## Setup

1. Install the dependencies:

   ```bash
   npm install
   ```

2. In Google Cloud Console → **Credentials**, download your OAuth client (Desktop app) and save it in this folder as `client_secret.json`.

3. Run your first upload. Your browser opens so you can sign in to Google and click **Allow**. The login is saved to `token.json`, so later uploads don't ask again.

> `client_secret.json` and `token.json` are secrets. They are in `.gitignore`: never commit or share them.

## Usage

```bash
npm run upload -- "my-video.mp4" --title "My first upload"
```

More options:

```bash
npm run upload -- "my-video.mp4" \
  --title "Trip to Da Lat" \
  --description-file description.txt \
  --tags "travel,vietnam,da lat" \
  --privacy unlisted
```

Schedule a video (it stays private until the time you set):

```bash
npm run upload -- "my-video.mp4" --title "Coming soon" --publish-at 2026-11-01T18:00:00+07:00
```

| Option | Meaning |
|---|---|
| `-t, --title` | Video title (required, max 100 characters) |
| `-d, --description` | Description text |
| `--description-file` | Read the description from a file |
| `--tags` | Comma-separated tags |
| `-p, --privacy` | `private` (default), `unlisted` or `public` |
| `--publish-at` | Schedule publishing (ISO date with time zone) |
| `--category` | Category id (default `22` = People & Blogs) |
| `--for-kids` | Mark the video as made for kids |
| `--client-secret` | Path to the OAuth client file |
| `--token` | Path to the saved login file |

`npm run upload` runs Node with `--use-system-ca`, so it also works on networks that inspect HTTPS (like many company networks).

## Limits to know

- **Private only until audited.** Until the Google Cloud project passes the YouTube API audit, every API upload is locked to private. Make it public in YouTube Studio.
- **Daily quota.** The default API quota allows only a handful of uploads per day. The tool tells you when it runs out.
- **Login expired?** Delete `token.json` and run again to sign in.
