# HealthOS

A private, iPhone-first health and lifestyle app covering nutrition, food photo analysis, recipes, meal planning, hydration, medication, sleep, workouts, a journal, routines, a timetable and statistics. Everything shares one on-device database, so a change in one section updates the others.

It has two parts:

| Part | Where it runs | What it does |
|---|---|---|
| The app (this folder) | GitHub Pages, installed to your Home Screen | All screens and data. Your data stays on the phone (IndexedDB) and works offline. |
| `worker/worker.js` | Cloudflare Workers (free plan) | Keeps your Gemini key secret, sends reminders every minute, stores a daily backup, receives Apple Health data. |

**Why GitHub alone isn't enough:** GitHub Pages only serves static files. It can't keep a secret or run anything on a timer. iPhone web notifications have to be *sent by a server* at the right moment; a web page can't schedule them itself. The Worker is that server. It's free and needs no command line.

> ⚠️ Free GitHub Pages repos are **public**. The code is safe to publish. Never commit your API key, your app token, or `healthos-starter-medications.json`.

---

## 1. Put the app on GitHub Pages (5 min)

1. Create a new repository on github.com, e.g. `healthos`.
2. **Add file → Upload files** → drag in everything in this folder (`index.html`, `sw.js`, `manifest.webmanifest`, `css/`, `js/`, `icons/`, `vendor/`, `worker/`, `tests/`, `package.json`, `README.md`, `.gitignore`). Commit.
3. **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, branch **main**, folder **/ (root)**. Save.
4. After a minute your app is at `https://<your-username>.github.io/healthos/`.

## 2. Create the Worker on Cloudflare (10 min, all in the browser)

1. Sign up at dash.cloudflare.com (free).
2. **Storage & Databases → KV → Create** a namespace called `healthos`.
3. **Workers & Pages → Create → Create Worker** → name it `healthos` → **Deploy**.
4. **Edit code** → delete the sample → paste the whole of `worker/worker.js` → **Deploy**.
5. Open the Worker → **Settings**:
   - **Bindings → Add → KV namespace**: variable name `KV`, namespace `healthos`.
   - **Variables and Secrets → Add**:
     - `GEMINI_API_KEY`, type **Secret**: your Google AI Studio key (the `AQ.` key works on this endpoint).
     - `APP_TOKEN`, type **Secret**: a long random password (30+ characters). You'll type it into the app once.
     - `VAPID_SUBJECT`, type **Text**: `mailto:` followed by your email. Apple rejects pushes without a real contact.
     - `ALLOWED_ORIGIN`, type **Text**: `https://<your-username>.github.io`
     - optional `GEMINI_MODEL`, type **Text**: e.g. `gemini-3.7-flash`. By default it tries `gemini-flash-latest` and then falls back.
   - **Triggers → Cron Triggers → Add**: `* * * * *` (every minute).
6. Copy the Worker URL, e.g. `https://healthos.<you>.workers.dev`. Opening it in a browser should show `{"app":"HealthOS worker","ok":true}`.

## 3. Install on your iPhone (5 min)

1. Open your GitHub Pages URL in **Safari** → **Share → Add to Home Screen**.
2. Open **HealthOS from the Home Screen icon**. Notifications only work from there, not from a Safari tab.
3. **Settings → Connection**: paste the Worker URL and your `APP_TOKEN` → **Save & test**. You should see "Connected · AI key ✓".
4. **Settings → Notifications → Enable notifications** → Allow → **Send test**.
5. **Settings → Data → Import JSON**: choose `healthos-starter-medications.json` (sent to you separately; keep it off GitHub) → **Merge**. Then open **Health → Meds** and fill in anything marked with a note (doses missing from your list, the Claritin frequency, the fish-oil check).
6. **Nutrition → Foods → Import AFCD**: in Safari, download the **Nutrient profiles** Excel file from Food Standards Australia New Zealand (foodstandards.gov.au → AFCD → downloadable files), then pick it in the app. This loads about 1,600 verified Australian foods. Until you do this, foods can only be matched to custom foods or label scans.

## 4. Test reminders on the real phone (do all of these)

- [ ] Test notification arrives with the app **closed** and the phone **locked**.
- [ ] Set a water reminder a few minutes ahead (Health → Water → Reminders), close the app, wait.
- [ ] Add a test task with a time 3 minutes ahead, close the app, wait.
- [ ] Tap a notification: it should open the right screen.
- [ ] Mark a medication taken: that slot's follow-up reminder should **not** come.
- [ ] Check notifications still arrive after restarting the phone.
- [ ] Check **Settings → Notifications → Notification history** shows "Sent".
- [ ] Check Focus modes / Sleep Focus don't silence HealthOS (iOS Settings → Focus → allowed apps).

If nothing arrives: check `VAPID_SUBJECT` is set, the cron trigger exists, and the app was opened from the Home Screen icon when you enabled notifications.

## 5. Apple Health (optional, via an iOS Shortcut)

Apple only lets native apps read HealthKit, so no web page can. The workaround: a Shortcut reads Health once a day and sends the numbers to your Worker. HealthOS pulls them in and labels them **Apple Health**, separate from what you typed.

In **Shortcuts → Automation → + → Time of Day** (e.g. 9:00 am, Daily, **Run Immediately**), build:

1. **Find Health Samples**: Type *Steps*, Start Date *is yesterday* → **Calculate Statistics** *Sum* → set variable `steps`.
2. **Find Health Samples**: Type *Resting Heart Rate*, sort *Latest first*, limit 1 → set variable `rhr`.
3. **Find Health Samples**: Type *Weight*, sort *Latest first*, limit 1 → set variable `weight`.
4. **Find Health Samples**: Type *Sleep Analysis*, value *is Asleep* (or Core/Deep/REM), Start Date *in the last 1 day* → **Get Details → Duration** → **Calculate Statistics** *Sum* → divide by 3600 → set variable `sleep`.
5. **Date** *Current Date* → **Format Date** custom `yyyy-MM-dd` → set variable `day`.
6. **Get Contents of URL**: `https://healthos.<you>.workers.dev/api/healthkit`, Method **POST**, Headers `Authorization` = `Bearer <APP_TOKEN>`, Request Body **JSON**: `date`=`day`, `steps`=`steps`, `resting_hr`=`rhr`, `weight_kg`=`weight`, `sleep_hours`=`sleep`.

Accepted fields: `steps, distance_km, exercise_min, active_kcal, resting_hr, avg_hr, sleep_hours, weight_kg`. Units in values like "8,432 steps" are stripped automatically. Writing back into Apple Health isn't automated; a Shortcut with **Log Health Sample** could do it if you want.

---

## How the pieces connect

- **One database, live updates.** Every save emits a change event. Today, Statistics and the reminder schedule all refresh from it. Logging water or a dose also tells the Worker, so it stops nagging once your water target is met or a medication is logged.
- **Nutrition maths is deterministic.** AI only *identifies* foods and *estimates grams*. Every number comes from per-100 g database values × grams (`js/nutrition.js`, unit-tested). An unknown nutrient is treated as unknown, not zero ("+?"). AI-estimated foods are only used if you choose them, and are labelled **Unverified**.
- **Confidence is shown.** Photo and description results show High/Medium/Low per item, a gram range, and weak database matches. Nothing saves until you press Save on the review screen.
- **Medication safety.** The app never changes doses or generates missed-dose advice. It shows instructions you paste in from your pharmacist or the medicine leaflet (CMI).
- **Imports.** Website links read schema.org recipe data first (exact text), then AI converts quantities to grams and marks any conversion. TikTok links can only use the caption; if the recipe is in the video, import screenshots. Missing servings or quantities block saving until you confirm them.

## Limits worth knowing

- Reminders fire within about a minute of the set time and need the phone to have internet. iOS can delay web push in Low Power Mode.
- For waking up, use the Clock app alarm. Web notifications can't play alarm sounds or break through Silent mode.
- AI food *image generation* was left out on purpose: a generated photo of food that doesn't exist adds cost and no information. Recipes use your own photo, or the source's.
- Cloudflare's free KV allows about 1,000 writes a day. Normal use is roughly 30–60.

## Updating the app

Edit files on GitHub, **bump `VERSION` in `sw.js`**, and commit. Then in the app go to **Settings → About → Check for app update**.

## Developing

```
npm install
npm test        # nutrition engine, AFCD parser, meal planner, reminder logic, push encryption, Worker API
```
Serve the folder with any static server, e.g. `npx serve .`.
