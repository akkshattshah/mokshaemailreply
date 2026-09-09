# Moksha inbox auto-reply

Auto-replies to the two kinds of mail that land in **hey@moksha.in** — job
applications and business enquiries — with copy written per email rather than
pasted from a template. **gurpreet.gandhi@moksha.in** is CC'd on every reply.

Runs as a Google Apps Script inside the mailbox itself. No server, no hosting,
no credentials stored anywhere outside Google.

For installation, see **[SETUP.md](SETUP.md)**. If you are taking this
project over from someone else, start with **[HANDOVER.md](HANDOVER.md)**.

---

## How it works

```
time trigger (every 5 min)
    │
    ├─ Gmail search: new inbox threads, minus anything already labelled
    │
    ├─ Guards.gs ......... 12 checks. No-reply addresses, newsletters,
    │                      autoresponders, internal mail, mass mailshots,
    │                      repeat senders, anything older than the install.
    │
    ├─ Llm.gs ............ one DeepSeek call classifies AND drafts.
    │                      job | business | other, plus confidence.
    │
    ├─ normalise_() ...... sanitises the model's output. Rejects unfilled
    │                      placeholders, enforces the sign-off, strips markdown.
    │
    ├─ job / business + confident  ->  reply, CC Gurpreet, label
    │  other / unsure              ->  label Needs-Review, send nothing
    │
    └─ AuditLog.gs ....... one row per decision in a Google Sheet
```

The classification and the drafting happen in a single model call. That is
cheaper, and more usefully it means the reply is written by the same pass that
worked out what kind of email this is.

## Files

| File | What it holds |
|---|---|
| `src/Config.gs` | Every setting. The only file you normally edit. |
| `src/Brand.gs` | **Fill this in.** The facts the model may state about Moksha. |
| `src/Setup.gs` | `setup()`, `status()`, `dryRunLatest()`, `sendSamplesToSelf()`, `uninstall()` |
| `src/Main.gs` | The pipeline the trigger runs |
| `src/Guards.gs` | Everything that decides an email must *not* get a reply |
| `src/Llm.gs` | Prompt, OpenRouter transport, output sanitiser, keyword fallback |
| `src/Templates.gs` | The hand-written copy, used only when the model is down |
| `src/Util.gs` | Address parsing, HTML rendering |
| `src/AuditLog.gs` | The Google Sheet log |
| `src/InboxAudit.gs` | `auditInbox()` — dry-run report over the real inbox |
| `tests/harness.js` | 94 assertions over the guards and the sanitiser |

## Functions you run by hand

Pick these from the function dropdown in the Apps Script editor.

| Function | Does |
|---|---|
| `setup()` | Installs. Safe to re-run. |
| `status()` | Prints whether it is running, how many replies today, the log link |
| `dryRunLatest()` | Classifies the newest eligible threads and prints the reply it *would* send. Sends nothing. |
| `sendSamplesToSelf()` | Mails one sample of each type to the mailbox, so the team can see what a recipient sees |
| `uninstall()` | Removes the trigger. Stops everything. |

## Safety rails

These are the reason auto-sending is defensible.

- **Install watermark.** Nothing that arrived before `setup()` ran is ever
  touched, so switching it on does not fire replies at the whole backlog.
- **Never twice to the same person** within 30 days, across threads.
- **Never into a live conversation.** If we have already spoken in a thread,
  it is left alone.
- **Never to machines.** `List-Unsubscribe`, `List-Id`, `Auto-Submitted`,
  `Precedence: bulk`, no-reply local parts, and job-board domains
  (Naukri, LinkedIn, Indeed and friends) are all denied. This is what stops a
  mail loop.
- **Caps.** 8 replies per run, 80 per day. Both are hard stops.
- **Confidence floor.** Below 0.7, or classified `other`, nothing is sent —
  the thread is labelled `Moksha/Needs-Review` for a human.
- **Placeholder rejection.** If the model ever emits `[Name]` or `[ROLE]`, the
  reply is thrown away rather than sent.
- **CC on everything.** Gurpreet sees every reply as it goes out.

## Turning it off

Fastest first:

1. In the editor, set `SENDING_ENABLED: false` in `Config.gs` and save. It
   keeps classifying and logging but sends nothing.
2. Or run `uninstall()` to remove the trigger entirely.
3. Or, to go quiet without stopping: set `SEND_MODE: false`. Replies are saved
   as Gmail drafts and labelled for review instead of sent.

## Cost

Real numbers, from the `usage` field of actual OpenRouter responses via
`tests/live-sample.js`, on `deepseek/deepseek-chat` at $0.2574/M input and
$1.029/M output:

| | Tokens | Cost |
|---|---|---|
| Prompt in (system + email + recent openers) | ~2,090 | $0.00054 |
| Reply out | ~130 | $0.00013 |
| **Per email** | | **$0.00067** |

| Inbox traffic | Per month |
|---|---|
| 10 / day | $0.20 |
| 25 / day | $0.50 |
| 50 / day | $1.00 |
| 80 / day (`MAX_REPLIES_PER_DAY`) | $1.61 |

Absolute ceiling, if every call ran to the full 900-token `MAX_TOKENS` and hit
the daily cap every day: **$3.51/month**. Spending more than that requires
editing `Config.gs`.

Filling in `Brand.gs` adds roughly 80 tokens to every call, well under a cent
a month. Re-run `node tests/live-sample.js` after any prompt edit; it prints
real usage and re-costs itself.

Two things bend the real number down. The guards in `Guards.gs` run *before*
the API call, so newsletters, no-reply addresses, job-board alerts and internal
mail cost nothing — they never reach DeepSeek. The flip side: an email
classified `other` still costs a call, because the model has to read one to
know it is junk. Cost tracks emails that pass screening, not replies sent.

**Cheaper option.** DeepSeek V3.2 is $0.2088/M in and $0.3096/M out. Since
output is 45% of the cost here, that lands around $0.00035/email, roughly 40%
less, on a newer model. One line in `Config.gs`:

```js
MODEL: 'deepseek/deepseek-v3.2',
```

Prices checked August 2026 against openrouter.ai/deepseek/deepseek-chat and
openrouter.ai/deepseek/deepseek-v3.2. Re-check before relying on them.

## What stops it feeling templated

Four separate mechanisms, because personalising one clause is not enough — a
reply with a name and a job title slotted in still reads as mail merge to
anyone who compares notes with a friend.

**1. No skeleton in the prompt.** `systemPrompt_()` gives the model a *reading*
task, not a form. It has to work out what the sender wants, what is specific
about their situation, and whether they asked a question — then write. Opening,
structure and length all vary with the email. Length is explicitly told to
follow theirs: a three-line note gets 40–70 words back, a detailed brief gets
100–160.

**2. It has to answer the question.** Most automated replies ignore whatever
was actually asked, which is the fastest way to feel processed rather than
read. The prompt requires any direct question to be addressed — from `Brand.gs`
if the answer is there, honestly deferred if it is not.

**3. It knows real things about Moksha.** `Brand.gs` is what lets a reply say
something true and specific back. Left empty, the model is instructed to stay
quiet rather than invent, so replies degrade to warm-but-generic instead of
confidently wrong. **Filling it in is the single highest-leverage change you
can make to reply quality.**

**4. It is told what it just said.** The last 8 opening lines are stored and
fed back with an instruction not to reuse them. Without this, a model at
temperature 0.75 still converges on one favourite first line within a dozen
emails — the failure mode that makes a personalised system read as a template
anyway.

Plus timing, which is not about words at all. `HUMAN_TIMING` holds each thread
for a randomised 9–47 minutes, derived from its own id so it does not drift
between runs, and only sends inside `WORK_DAYS` / `WORK_START_HOUR`–
`WORK_END_HOUR`. A reply landing 90 seconds after the email at 3am on a Sunday
reads as a machine however well it is written.

## Tuning the copy

The tone lives in `systemPrompt_()` in `src/Llm.gs`. The two hand-written
reference replies are embedded there as the tone anchor, and rules 1–9 below
them are what keep the model honest — particularly rule 2, which forces one
concrete detail from the sender's own email into every reply, and rule 4,
which forbids promising an interview, a rate, or a timeline.

After any edit to the prompt, run `dryRunLatest()` and read the output before
letting it send.

## Tests

```
node tests/harness.js
```

Runs the real source files under stubbed Google services. Covers address
parsing, the guard matrix, the fallback classifier and the output sanitiser.
It does not call OpenRouter.
