-- =============================================================================
-- Movvy — Migration 0056: AI support chatbot on support threads
--
-- Adds the columns the support-ai-reply edge function needs to auto-answer
-- customer/partner support chats and hand off to a human when needed:
--   • chat_messages.is_ai        — mark a message as written by the assistant
--     (still is_admin=true so it renders on the Movvy side of the bubble).
--   • chat_messages.sender_profile_id becomes nullable — the assistant has no
--     profile row; its messages are inserted by the service role, which
--     bypasses RLS, so a null sender is safe and correct.
--   • chat_threads.ai_enabled    — per-thread kill switch (agent "takes over").
--   • chat_threads.needs_human   — the assistant escalated; surfaces in admin.
--   • chat_threads.escalated_at / escalation_reason — audit of the handoff.
-- =============================================================================

alter table chat_messages
  add column if not exists is_ai boolean not null default false;

-- The assistant is not a profile — allow system-authored messages.
alter table chat_messages
  alter column sender_profile_id drop not null;

alter table chat_threads
  add column if not exists ai_enabled boolean not null default true;
alter table chat_threads
  add column if not exists needs_human boolean not null default false;
alter table chat_threads
  add column if not exists escalated_at timestamptz;
alter table chat_threads
  add column if not exists escalation_reason text;

-- Surface "needs a human" threads fast in the admin inbox.
create index if not exists chat_threads_needs_human_idx
  on chat_threads (needs_human) where needs_human;
