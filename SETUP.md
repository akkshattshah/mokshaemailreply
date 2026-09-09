# Setup

Roughly 15 minutes. You need the OpenRouter API key; the person who can sign
in to **hey@moksha.in** needs about 2 minutes at the end.

> **The one thing to get right.** A Google Apps Script trigger runs as *the
> person who installed it*, on *their* mailbox. So `setup()` must be run while
> signed in as **hey@moksha.in** and nobody else. If you run it from your own
> Google account, it will start auto-replying to **your** inbox.

---

## Which path

**Path A — you have the hey@moksha.in password.** Sign in as that account and
do everything yourself. Simplest. Skip to step 1 and stay signed in as
hey@moksha.in throughout.

**Path B — someone else holds that account.** You build the project in your own
Drive, then send them a link. They click one button and approve. Google's
consent screen is the verification step you asked about. Steps 1–4 are yours,
step 5 is theirs.

---

## 1. Create the project

Go to **[script.google.com](https://script.google.com)** → **New project**.

Rename it (top left) to `Moksha Inbox Auto-Reply`.

## 2. Add the code

Ten files. In the left sidebar under **Files**, use **+ → Script** for each
one, name it exactly as below *without* the `.gs` (Apps Script adds it), and
paste the contents.

```
Config.gs      Brand.gs      Setup.gs      Main.gs
Guards.gs      Llm.gs        Templates.gs  Util.gs
AuditLog.gs    InboxAudit.gs
```

Then the manifest. Click the **gear icon (Project Settings)** in the far-left
rail and tick **"Show appsscript.json manifest file in editor"**. Go back to
the editor, open the `appsscript.json` that has appeared, and replace its
contents with `src/appsscript.json` from this repo.

Delete the default `Code.gs` that the project was created with.

Save (Ctrl+S).

## 3. Add the OpenRouter key

**Project Settings** (gear icon) → scroll to **Script Properties** →
**Add script property**.

| Property | Value |
|---|---|
| `OPENROUTER_API_KEY` | `sk-or-v1-...` |

Click **Save script properties**.

### Why not a .env file

There isn't one, and Apps Script can't use one. The code runs on Google's
servers, not on a machine with a filesystem — there is no `process.env`, no
`dotenv`, nothing to read a file from. A `.env` added in the Apps Script editor
would simply become another script file in the project, sitting in plain sight
next to the rest of the code. Script Properties *is* the equivalent, and it is
the mechanism Google provides for exactly this.

It keeps the key out of the source: it never appears in a file, never gets
copied when someone copies a script, and never lands in a shared doc or a
screenshot of the code.

### Who can still read it

**Anyone with Editor access to this project can open Project Settings and read
the key in plain text.** Path B requires giving the installer Editor access —
you cannot run a function from the editor with view-only access — so in that
path they *can* see it if they go looking. Script Properties keeps the key out
of the code; it does not hide it from your collaborators.

Bound the exposure rather than trying to hide it:

- Use a key created **only** for this script, not one shared with other tools.
- Cap it on the OpenRouter dashboard. $5/month is generous here and makes a
  leak an annoyance rather than a bill.
- Rotate it if whoever manages the mailbox changes. Paste the new value over
  the old property; nothing else needs touching.
- Or use Path A, sign in as hey@moksha.in yourself, and never share the
  project at all.

## 4. Fill in Brand.gs, then check the settings

**Do not skip `Brand.gs`.** It is the difference between a reply that sounds
like it came from someone at Moksha and one that sounds like a bot being
pleasant. Every field is a fact the model is permitted to state; anything left
blank, it is forbidden from guessing at. Leave the whole file empty and replies
still go out, but they stay generic, because the model genuinely has nothing
true to say about the agency.

```js
what_we_do:       'brand strategy, performance marketing, social content
                   and influencer campaigns',
sectors:          'mostly D2C, F&B, hospitality and consumer tech across India',
based_in:         'Mumbai, a team of around 25',
hiring_process:   'the team reviews applications every Friday, and anyone
                   shortlisted gets a 20 minute call first',
business_process: 'we usually start with a 30 minute discovery call, and
                   scope only after that',
open_roles:       'content writer, performance marketing associate'
```

Those are illustrative, not real. Replace them with what is actually true, and
keep `open_roles` current — a stale list there is worse than an empty one.

Then open `Config.gs` and confirm the top block:

```js
CC_ON_EVERY_REPLY: 'gurpreet.gandhi@moksha.in',
FROM_NAME:         'Team Moksha',
SENDING_ENABLED:   true,
SEND_MODE:         true,   // false = save drafts instead of sending
```

**If you want a cautious first week**, set `SEND_MODE: false` now. Everything
runs identically but replies are saved as Gmail drafts and labelled
`Moksha/Needs-Review` instead of going out. Flip it back to `true` once the
team has read a dozen of them.

### Path B only — share the link

Click **Share** (top right, or via the project's entry in Drive). Add the
address of whoever holds hey@moksha.in as an **Editor**. Copy the link and
send it to them along with step 5 below.

## 4b. Audit the real inbox before going live

**Do this before `setup()`.** `auditInbox()` reads the actual inbox, runs the
real guards and the real model over a sample, and prints how much of it would
get a reply and how much would be left alone. It sends nothing, labels nothing
and changes nothing; the only cost is about a cent in model calls.

Function dropdown → `auditInbox` → **Run**. Google will ask for authorisation
here rather than at step 5 — same consent screen, described below.

For a publicly listed address that gets mostly spam, this is the number that
decides whether to switch it on at all. Read the "would reply" examples and
check every one is genuinely something Moksha would want answered.

`auditInbox(25, 100)` samples 25 threads out of the last 100. Lower the first
number if the run times out.

## 5. Install — run as hey@moksha.in

**This is the step that must happen in the hey@moksha.in account.**

1. Open the project link, signed in as **hey@moksha.in**.
2. In the toolbar, set the function dropdown to **`setup`**.
3. Click **Run**.
4. Google asks for authorisation:
   - **Review permissions** → choose the hey@moksha.in account
   - You will see *"Google hasn't verified this app"*. This is expected — it
     is a private script, not a published add-on. Click **Advanced**, then
     **Go to Moksha Inbox Auto-Reply (unsafe)**.
   - Read the permission list, then **Allow**.
5. The execution log at the bottom should print something like:

```
Installing for: hey@moksha.in
OpenRouter API key: found
Gmail labels: ready
Watermark set: ... (anything older is ignored)
Audit log: https://docs.google.com/spreadsheets/d/...
Trigger: processInbox every 5 minutes
Live. CC on every reply: gurpreet.gandhi@moksha.in
```

That's it. It is running.

### What the permissions are for

| Permission | Why |
|---|---|
| Read, compose, send and permanently delete your email | Apps Script's Gmail API is all-or-nothing; the script only searches, replies and labels. It never deletes. |
| Connect to an external service | The OpenRouter call that writes the reply |
| Create and update Google Sheets | The audit log |
| See, edit, create and delete only the files it uses | Sharing that audit log with Gurpreet |
| Run when you are not present | The 5-minute trigger |

## 6. Verify it works

Still in the editor, run these from the function dropdown.

**`status()`** — should show 1 active trigger, API key present, the account
name, and a link to the audit log.

**`sendSamplesToSelf()`** — writes a reply to one fake job application and one
fake business brief, and mails both to hey@moksha.in. Read them. This is
exactly what a real sender receives, minus the grey banner at the top.

**`dryRunLatest()`** — takes real threads currently in the inbox, classifies
them, and prints the reply it *would* send without sending anything.

If a sample reads wrong, edit `systemPrompt_()` in `Llm.gs`, save, and run
`sendSamplesToSelf()` again. Iterate there, not on real mail.

## 7. First week

- The audit log sheet is shared with Gurpreet automatically. One row per
  decision, including everything that was ignored and why.
- Watch the `Moksha/Needs-Review` label. Anything the model was unsure about
  lands there, and a pattern in that label usually means one line of the
  prompt needs tightening.
- `status()` tells you the daily count against the 80/day cap.

---

## Optional: push with clasp instead of pasting

If you have Node installed and would rather not paste eight files:

```bash
npm install -g @google/clasp
clasp login                      # sign in as hey@moksha.in
clasp create --type standalone --title "Moksha Inbox Auto-Reply" --rootDir ./src
clasp push
```

Then still do steps 3 and 5 in the browser — the API key and the OAuth
approval both have to happen there.

---

## Troubleshooting

**"OPENROUTER_API_KEY is not set"** — step 3, and check for a trailing space in
the pasted value.

**`setup()` ran but nothing gets replied to.** Run `status()`. If triggers is 0,
run `setup()` again. If it is 1, remember the watermark: only mail arriving
*after* install is eligible. Send a test from an outside address.

**Everything lands in `Moksha/Needs-Review`.** The model is classifying as
`other` or scoring below 0.7. Open the audit log — the reason column says
which. If genuine enquiries are being called `other`, the category
descriptions in `systemPrompt_()` need widening.

**"Service invoked too many times" or "Limit exceeded".** Gmail's daily send
quota. Consumer Gmail allows 100 recipients/day, Workspace 1,500. Each reply
uses two (recipient + CC). Lower `MAX_REPLIES_PER_DAY` if needed.

**OpenRouter HTTP 402.** Out of credit. The bot falls back to the hand-written
template copy meanwhile, so nobody is left unanswered — but replies stop being
personalised until you top up.

**Someone got two replies.** Should not happen: the thread label, the
30-day per-sender check and the script lock each prevent it independently. If
it does, send me the two rows from the audit log.

**It replied to something it shouldn't have.** Set `SENDING_ENABLED: false`
immediately, then add the sender's domain to `BLOCKED_DOMAINS` in `Config.gs`.
