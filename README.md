# MindVault — Deploy Guide

Full deployment: Neon (database) → Vercel (web app) → Play Store (Android)

---

## Prerequisites

Install these once on your machine:

```bash
npm install -g vercel          # Vercel CLI
npm install -g @bubblewrap/cli # Android TWA builder
npm install -g @google/bundletool # For AAB → APK testing (optional)
```

Also install Java 11+ (needed by bubblewrap):
- Mac: `brew install openjdk@11`
- Windows: https://adoptium.net/

---

## Step 1 — Neon Database

1. Log in at **neon.tech**
2. Click **New Project** → name it `mindvault`
3. In the project dashboard, click **SQL Editor**
4. Paste the entire contents of `schema.sql` and click **Run**
5. Go to **Connection Details** → copy the **Connection string** (starts with `postgresql://`)

---

## Step 2 — Environment Variables

Copy the example file:
```bash
cp .env.example .env
```

Edit `.env`:
```
DATABASE_URL=postgresql://...  ← paste your Neon connection string
JWT_SECRET=...                 ← generate with: openssl rand -base64 48
```

---

## Step 3 — Deploy to Vercel

### First time setup:
```bash
cd mindvault
npm install
vercel login        # opens browser to authenticate
vercel              # follow prompts, creates project
```

When prompted:
- **Set up and deploy?** → `Y`
- **Which scope?** → your account
- **Link to existing project?** → `N`
- **Project name?** → `mindvault`
- **Directory?** → `./`
- **Override settings?** → `N`

### Add environment variables to Vercel:
```bash
vercel env add DATABASE_URL
# paste your Neon connection string, select all environments

vercel env add JWT_SECRET
# paste your JWT secret, select all environments
```

### Deploy to production:
```bash
vercel --prod
```

Your app is now live at `https://mindvault.vercel.app` (or similar).
Note the URL — you'll need it for the Android step.

### Subsequent deploys:
```bash
vercel --prod
```

---

## Step 4 — Update App URLs

Once you have your Vercel URL, update two files:

**`android/twa-manifest.json`** — replace `your-app.vercel.app`:
```json
"host": "mindvault.vercel.app",
"iconUrl": "https://mindvault.vercel.app/icons/icon-512.png",
...
```

**`public/.well-known/assetlinks.json`** — you'll fill in the fingerprint in Step 6.

---

## Step 5 — Create App Icons

You need PNG icons in `public/icons/`. Required sizes:

| File | Size |
|------|------|
| icon-72.png | 72×72 |
| icon-96.png | 96×96 |
| icon-128.png | 128×128 |
| icon-144.png | 144×144 |
| icon-152.png | 152×152 |
| **icon-192.png** | 192×192 (required) |
| icon-384.png | 384×384 |
| **icon-512.png** | 512×512 (required) |

**Quick option:** Use https://realfavicongenerator.net — upload one 512×512 PNG and it generates all sizes.

The icon should be your MindVault logo on a dark `#090b11` background, or a square with padding for "maskable" icon safe zones.

After adding icons, redeploy:
```bash
vercel --prod
```

---

## Step 6 — Android TWA (Play Store)

### 6a. Initialise the Android project

```bash
cd android
bubblewrap init --manifest https://mindvault.vercel.app/manifest.json
```

Bubblewrap will ask you several questions. Key answers:
- **Domain**: `mindvault.vercel.app`
- **Application ID**: `com.yourname.mindvault`  
- **App name**: `MindVault`
- **Short name**: `MindVault`
- **Version code**: `1`
- **Version name**: `1.0.0`
- **Signing key store**: `./mindvault.keystore` (it will create this)
- **Signing key alias**: `mindvault`
- **Key store password**: choose a strong password — **save it somewhere safe**

### 6b. Get your SHA-256 fingerprint

```bash
keytool -list -v -keystore ./mindvault.keystore -alias mindvault -storepass YOUR_PASSWORD
```

Look for the line:
```
SHA256: AA:BB:CC:DD:...
```

Copy the full fingerprint.

### 6c. Update assetlinks.json

Edit `public/.well-known/assetlinks.json`:
```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.yourname.mindvault",
    "sha256_cert_fingerprints": [
      "AA:BB:CC:DD:..."   ← paste your fingerprint here
    ]
  }
}]
```

Redeploy to Vercel:
```bash
cd ..
vercel --prod
```

Verify it works:
```
https://mindvault.vercel.app/.well-known/assetlinks.json
```
Should return the JSON.

### 6d. Build the Android App Bundle

```bash
cd android
bubblewrap build
```

This produces:
- `app-release-bundle.aab` — for Play Store upload
- `app-release-signed.apk` — for direct testing

### 6e. Test on your device

```bash
adb install app-release-signed.apk
```

Or email yourself the APK and install it manually (enable "Install unknown apps" in Android settings).

**Important:** Test that the URL bar is hidden when you launch via the installed app. If the browser bar is showing, the `assetlinks.json` is not being verified correctly. Double-check the fingerprint and wait a few minutes after deploying.

---

## Step 7 — Play Store Submission

1. Go to **play.google.com/console** → your account
2. **Create app** → App name: "MindVault" → Category: Games → Health & Fitness
3. Fill in the **store listing**:
   - Short description: "Daily memory training for sharp minds"
   - Full description: Describe the 6 games
   - Upload screenshots (take them from your phone with the app installed)
4. **Production** → Create new release → Upload `app-release-bundle.aab`
5. Fill in content rating questionnaire → submit
6. Google reviews typically take **3–7 days** for new apps

---

## Project Structure

```
mindvault/
├── public/                  # Static files served by Vercel
│   ├── index.html           # The full game app
│   ├── manifest.json        # PWA manifest
│   ├── sw.js                # Service worker (offline support)
│   ├── icons/               # App icons (you add these)
│   └── .well-known/
│       └── assetlinks.json  # Android TWA verification
├── api/
│   ├── auth/
│   │   ├── register.js      # POST /api/auth/register
│   │   └── login.js         # POST /api/auth/login
│   └── stats/
│       ├── get.js           # GET  /api/stats/get
│       └── save.js          # POST /api/stats/save
├── lib/
│   ├── db.js                # Neon database connection
│   └── auth.js              # JWT helpers
├── android/
│   └── twa-manifest.json    # Bubblewrap TWA config
├── schema.sql               # Run this in Neon SQL editor
├── vercel.json              # Vercel routing config
├── package.json
└── .env.example             # Copy to .env and fill in
```

---

## API Reference

| Endpoint | Method | Auth | Body |
|----------|--------|------|------|
| `/api/auth/register` | POST | — | `{ email, password }` |
| `/api/auth/login` | POST | — | `{ email, password }` |
| `/api/stats/get` | GET | Bearer token | — |
| `/api/stats/save` | POST | Bearer token | `{ scores, games_played, streak, last_played }` |

---

## Troubleshooting

**"DATABASE_URL is not set" on Vercel**
→ Run `vercel env add DATABASE_URL` and redeploy

**"Invalid token" errors**
→ JWT_SECRET may differ between environments. Make sure it's set in Vercel env vars.

**Browser bar shows in Android app (TWA not verifying)**
→ Check assetlinks.json fingerprint exactly matches your keystore. Use Chrome DevTools adb debug to see verification errors.

**App rejected from Play Store**
→ Most common reason for new apps: missing privacy policy. Host a simple one at `/privacy` and add it to your store listing.
