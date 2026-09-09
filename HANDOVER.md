# Handover

Everything a new owner needs to take this project over and put it live. Read
this first, then [SETUP.md](SETUP.md) for the click-by-click install.

---

## 1. What you are being given

A Google Apps Script that lives inside the **hey@moksha.in** mailbox and
auto-replies to the two kinds of mail worth answering — job applications and
business enquiries — with copy written per email rather than pasted from a
template. **gurpreet.gandhi@moksha.in** is CC'd on every reply.

There is nothing to deploy in the usual sense. No server, no container, no
hosting bill, no CI. The whole thing is ten `.gs` files pasted into an Apps
Script project attached to the mailbox, plus a time trigger that runs every 5
minutes. The only external dependency is one OpenRouter API call per email that
gets past the guards.

**State of the code: complete and tested.** 94 assertions pass locally
(`node tests/harness.js`). It has been run against a real inbox sample via
`auditInbox()`. What remains is the install, which has to happen in the
hey@moksha.in Google account and nowhere else.

---

## 2. What is in the repo, and what is deliberately not

```
src/                 the ten Apps Script files + the manifest
tests/               local test scripts, run with plain node — no npm install
README.md            what it does, how it works, cost, tuning
SETUP.md             the install, step by step
HANDOVER.md          this file
.env.example         the shape of the .env you create locally
```

**Not in the repo, on purpose:**

| Missing | Why | What you do |
|---|---|---|
| `.env` (the real OpenRouter key) | Gitignored. Keys never go in git. | Get the key from Akkshatt, or create your own at [openrouter.ai/keys](https://openrouter.ai/keys). Copy `.env.example` to `.env` and paste it in. |
| `.clasp.json` (the Apps Script project id) | Gitignored, and it points at the original author's project. | You create your own project. `clasp create` writes this file for you if you take the clasp path. |
| `node_modules/`, `package.json` | There are no dependencies. The tests use only Node built-ins. | Nothing. `node tests/harness.js` works on a clean clone. |

There is no build step, no bundler and no lockfile. If you find yourself
running `npm install`, you have taken a wrong turn.

---

## 3. What you need before you can finish

1. **The OpenRouter API key** — from Akkshatt, or your own. Put a **$5/month
   cap** on it; real usage is under $2/month at the hard daily cap.
2. **Sign-in to hey@moksha.in**, *or* an Editor invite to the Apps Script
   project plus someone who can sign in as that account for two minutes.
   This is the one thing you cannot work around — see the warning below.
3. Confirmation that **gurpreet.gandhi@moksha.in** is still the right CC
   address.

### The one thing to get right

> An Apps Script time trigger runs as **the person who installed it**, on
> **their** mailbox. `setup()` must be run while signed in as
> **hey@moksha.in**. Run it from your own Google account and it will start
> auto-replying to *your* inbox.

Everything else in the build is reversible. This is the part that is not.

---

## 4. Build path

Two ways to get the code into Apps Script. Both end at the same place.

**A — paste it in (no tooling, ~10 min).** Follow [SETUP.md](SETUP.md) §2.
Create ten script files named exactly as the `src/*.gs` files (without the
extension — Apps Script adds it), paste each one, then enable the manifest in
Project Settings and replace it with `src/appsscript.json`. Delete the default
`Code.gs`.

**B — push with clasp (needs Node).**

```bash
npm install -g @google/clasp
clasp login                     # sign in as hey@moksha.in
clasp create --type standalone --title "Moksha Inbox Auto-Reply" --rootDir ./src
clasp push
```

Either way, the API key (§5 below) and the OAuth approval still have to happen
in the browser. clasp cannot do those.

---

## 5. The four things that must be done before it goes live

Skipping any of these produces something that runs but is wrong.

**1. The API key goes in Script Properties, not a file.**
Project Settings (gear icon) → Script Properties → add
`OPENROUTER_API_KEY` = `sk-or-v1-...`. Apps Script has no filesystem and no
`process.env`; a `.env` pasted into the editor would just be another script
file sitting in plain sight. Note that anyone with Editor access to the project
can read this value — bound the exposure with a per-script key and a spend cap
rather than trying to hide it.

**2. Re-read `src/Brand.gs`.**
Every field there is a fact the model is *permitted* to state; anything blank,
it is forbidden from guessing at. It is currently filled in with what Moksha
does, its sectors, and how hiring and new business actually run — but
`based_in` and `open_roles` are empty, and the rest was written in August 2026.
Verify it is still true. A stale `open_roles` is worse than an empty one, and
`never_say` is what stops the model promising an interview or quoting a rate.

**3. Check the top block of `src/Config.gs`.**

```js
CC_ON_EVERY_REPLY: 'gurpreet.gandhi@moksha.in',
FROM_NAME:         'Team Moksha',
SENDING_ENABLED:   true,
SEND_MODE:         true,   // false = save drafts instead of sending
```

**Recommended for the first week: `SEND_MODE: false`.** Everything runs
identically, but replies are saved as Gmail drafts and labelled for review
instead of going out. Flip it to `true` once the team has read a dozen.

**4. Run `auditInbox()` before `setup()`.**
It reads the real inbox, runs the real guards and the real model over a sample,
and prints how much would get a reply and how much would be left alone. It
sends nothing, labels nothing, changes nothing. Costs about a cent. For a
publicly listed address, this is the number that decides whether to switch it
on at all.

Then run `setup()` — signed in as hey@moksha.in — and verify with `status()`,
`sendSamplesToSelf()` and `dryRunLatest()`.

---

## 6. How it fits together

```
time trigger (every 5 min) -> processInbox()          Main.gs
    │
    ├─ Gmail search, minus anything already labelled   Main.gs
    ├─ 12 guards, all before any API call              Guards.gs
    ├─ one model call: classify AND draft              Llm.gs
    ├─ normalise_(): reject placeholders, fix sign-off Llm.gs
    ├─ send / draft, CC Gurpreet, label                Main.gs
    └─ one row per decision in a Google Sheet          AuditLog.gs
```

| File | What it holds |
|---|---|
| `Config.gs` | Every setting. The only file you normally edit. |
| `Brand.gs` | The facts the model may state about Moksha. |
| `Setup.gs` | `setup()`, `status()`, `dryRunLatest()`, `sendSamplesToSelf()`, `uninstall()` |
| `Main.gs` | The pipeline the trigger runs |
| `Guards.gs` | Everything that decides an email must *not* get a reply |
| `Llm.gs` | Prompt, OpenRouter transport, output sanitiser, keyword fallback |
| `InboxAudit.gs` | `auditInbox()` — dry-run report over the real inbox |
| `Templates.gs` | Hand-written copy, used only when the model is down |
| `Util.gs` | Address parsing, HTML rendering |
| `AuditLog.gs` | The Google Sheet log |

Functions you run by hand from the editor's function dropdown:

| Function | Does |
|---|---|
| `setup()` | Installs. Idempotent — safe to re-run. |
| `status()` | Trigger count, key presence, replies today, log link |
| `auditInbox(25, 100)` | Samples the real inbox and reports. Sends nothing. |
| `dryRunLatest()` | Prints the reply it *would* send for live threads |
| `sendSamplesToSelf()` | Mails one sample of each type to the mailbox |
| `uninstall()` | Removes the trigger. Stops everything. |

---

## 7. Decisions worth not undoing

These look like they could be simplified. They cannot.

**The install watermark.** `setup()` stamps the current time; nothing older is
ever touched. Remove it and switching the bot on fires replies at the entire
backlog.

**The guards run before the API call.** Newsletters, no-reply addresses,
job-board alerts and internal mail cost nothing because they never reach
DeepSeek. Moving the classifier earlier would make it both slower and more
expensive.

**Classification and drafting are one call, not two.** Cheaper, and the reply
is written by the same pass that worked out what kind of email this is.

**`HUMAN_TIMING` holds each thread 9–47 minutes** and only sends inside working
hours. The delay is derived from the thread id, so it is stable across runs
instead of drifting. A reply landing 90 seconds after the email at 3am on a
Sunday reads as a machine however well it is written. `LOOKBACK_DAYS: 5` exists
to cover the longest possible hold — a Friday evening email waiting until
Monday morning is ~62 hours — so do not lower it to 3.

**The last 8 opening lines are fed back to the model** with an instruction not
to reuse them. Without this, a model at temperature 0.75 converges on one
favourite first line within a dozen emails, which is exactly the failure mode
that makes a personalised system read as a template anyway.

**`normalise_()` throws away any reply containing an unfilled placeholder.**
`[Name]` reaching a real applicant is the worst single outcome here. Better to
send nothing and let it land in `Moksha/Needs-Review`.

**Confidence floor of 0.7 and the `other` category send nothing.** They label
for a human instead. If genuine enquiries start landing in Needs-Review, widen
the category descriptions in `systemPrompt_()` — don't lower the floor.

---

## 8. Testing locally

```bash
node tests/harness.js              # 94 assertions, no network, no key needed
node tests/live-sample.js          # real prompt -> real model, ~$0.004/run
node tests/classification-eval.js  # labelled set -> confusion matrix
```

`harness.js` runs the real `src/*.gs` files under stubbed Google services and
covers address parsing, the guard matrix, the fallback classifier and the
output sanitiser. It never calls OpenRouter — run it on every change.

The other two need `.env` with a working key. `live-sample.js` prints real
token usage and re-costs itself, so run it after **any** edit to
`systemPrompt_()` in `Llm.gs`. Iterate on the tone there and in
`sendSamplesToSelf()` — never on real mail.

---

## 9. Turning it off, fastest first

1. `SENDING_ENABLED: false` in `Config.gs`, save. Keeps classifying and logging,
   sends nothing. Takes effect on the next run.
2. `SEND_MODE: false` — replies become Gmail drafts instead. Quiet, not stopped.
3. `uninstall()` — removes the trigger entirely.

If it ever replies to something it shouldn't: `SENDING_ENABLED: false` first,
then add the sender's domain to `BLOCKED_DOMAINS`.

---

## 10. Things that will bite you

- **Gmail's daily send quota.** Consumer Gmail allows 100 recipients/day,
  Workspace 1,500. Each reply uses two (recipient + CC). `MAX_REPLIES_PER_DAY`
  is 80, i.e. 160 recipients — fine on Workspace, over the line on consumer
  Gmail. Check which one hey@moksha.in is.
- **"Google hasn't verified this app"** on the consent screen is expected. It
  is a private script, not a published add-on. Advanced → Go to … (unsafe).
- **The Gmail scope is all-or-nothing.** `https://mail.google.com/` includes
  delete. The script never deletes anything, but the consent screen will say it
  can. Worth explaining before you put it in front of whoever approves it.
- **OpenRouter 402** means out of credit. The bot falls back to the
  hand-written template copy, so nobody is left unanswered — but replies stop
  being personalised until you top up.
- **The audit log sheet auto-shares with `CC_ON_EVERY_REPLY`.** Change that
  address and the new person gets the sheet; the old one keeps their access
  until you remove it by hand.
- **Everything lands in Needs-Review** usually means the category descriptions
  in `systemPrompt_()` are too narrow. The audit log's reason column says which
  of `other` / low-confidence it was.

---

## 11. Handover checklist

- [ ] Clone the repo, run `node tests/harness.js`, see 94 passed
- [ ] Get the OpenRouter key; cap it at $5/month
- [ ] `cp .env.example .env`, paste the key, run `node tests/live-sample.js`
- [ ] Read the four sample replies. Adjust `systemPrompt_()` if the tone is off
- [ ] Create the Apps Script project (paste or clasp)
- [ ] Add `OPENROUTER_API_KEY` to Script Properties
- [ ] Verify `Brand.gs` is still accurate; fill `based_in` / `open_roles` or leave blank
- [ ] Confirm the CC address in `Config.gs`; set `SEND_MODE: false` for week one
- [ ] Run `auditInbox()` and read the "would reply" examples
- [ ] Signed in as **hey@moksha.in**: run `setup()`, approve the consent screen
- [ ] Run `status()` — 1 trigger, key found, correct account
- [ ] Run `sendSamplesToSelf()` and read both replies as a recipient would
- [ ] Confirm Gurpreet can open the audit log sheet
- [ ] After a week of drafts: flip `SEND_MODE: true`

---

## 12. Open items

- `Brand.gs` `based_in` and `open_roles` are empty by choice — the model stays
  silent on both rather than guessing. Fill them if you want replies to say
  where the team is or what is open.
- Model pricing in README.md was checked **August 2026**. Re-check before
  relying on the cost table. `deepseek/deepseek-v3.2` is roughly 40% cheaper
  and a one-line change in `Config.gs`.
- `BLOCKED_DOMAINS` grew from a real inbox audit on 31 Aug 2026. Re-run
  `auditInbox()` after a month live and add whatever new noise shows up — each
  domain added there is one fewer API call.
