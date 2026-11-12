# Broadcasts and automation

## Marketing consent

Raseel only sends broadcasts to contacts with **marketing consent** (opt-in). Consent is recorded with a timestamp when:

- an agent ticks _Marketing consent_ on the contact profile, or
- a CSV import has `opt_in` = `yes` / `نعم` for that row.

Customers can withdraw consent at any time by replying **STOP**, **Unsubscribe**, **إيقاف** or **إلغاء الاشتراك**. Raseel removes their consent immediately and skips them in every broadcast, including ones already running. Every change is written to the audit log.

## Segments

_Settings → Segments_ saves a filter on tags (any or all), custom field values and language. The preview shows how many contacts match and how many of them have consent.

## Broadcasts

1. _Broadcasts → New broadcast_: pick an approved template, an audience and how to fill each variable (typed text or a contact field such as the first name).
2. Send now or schedule a time. Raseel sends through a throttled queue (`BROADCAST_RATE_PER_SECOND`, default 20) and retries temporary errors without sending duplicates.
3. The report shows sent, delivered, read, replied and failed counts, plus each recipient.

> [!IMPORTANT]
> WhatsApp limits how many new customers a number can message in 24 hours (its _messaging tier_). Large first-time campaigns can be paused by Meta. Grow your audience gradually and keep your quality rating green.

Broadcasts never reopen conversations your team has closed; a conversation reopens only when the customer replies.

## Automation

_Settings → Automation_:

| Feature         | Behaviour                                                                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Working hours   | Per-day opening times in the business time zone. Outside them, the away message is sent at most once every 12 hours per conversation.                                                                                 |
| Welcome message | Sent once to customers who write for the first time, with up to three reply buttons.                                                                                                                                  |
| Keyword rules   | The first active rule whose keyword appears in a customer message runs: add a tag, assign an agent or team, and/or reply. Matching ignores tashkeel and alef/taa/yaa variants; add plural forms as separate keywords. |

Automated messages are marked ⚙️ in the inbox. They are sent right after the customer's message, so they are always inside the 24-hour window.

## Deals, tasks and CSV

- _Deals_ is a Kanban board in SAR; drag deals between stages. Stages are edited in _Settings → Deal stages_.
- _Tasks_ can be linked to a contact or deal; the assignee gets a reminder when a task falls due.
- _Contacts → Import CSV_ accepts Arabic or English headers (`phone`/`الجوال`, `name`/`الاسم`, `tags`/`الوسوم`, `opt_in`/`الموافقة`, …) and converts local Saudi numbers (05…) to international format. _Export CSV_ (Owner only) opens correctly in Excel.
