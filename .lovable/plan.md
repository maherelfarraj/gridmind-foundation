# Plan — Adopt Lovable-chat-only database workflow

## New rule
The Supabase SQL Editor is retired from this project's workflow. All database operations from this point forward must be handled through the Lovable chat.

## What changes
1. **Migrations**: I will create and apply migrations via `supabase--migration` in Lovable chat only. I will never suggest using the Supabase SQL Editor directly.
2. **Verification queries**: I will run read-only checks via `supabase--read_query` in Lovable chat and paste the raw results back into the chat for confirmation.
3. **My role**: I will continue to paste prompts to Lovable, read the returned results, and capture screenshots of any unexpected output so we can diagnose it together.
4. **Memory**: Save this rule to `mem://index.md` under Core and create a `mem://workflow/supabase-chat-only` constraint file so it is automatically applied in every future session.

## Outcome
This eliminates the entire class of "wrong project / wrong SQL Editor session" errors by making Lovable the single source of truth for database state changes.

## Approval
Approve this plan to lock in the workflow. Once approved, I will save the memory file and continue with any pending migrations or queries you paste next.