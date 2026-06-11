-- =============================================================================
-- Movvy — Migration 0023: 'declined' invite status
--
-- The invitee can now refuse a company's invite from the in-app popup.
-- 'cancelled' is reserved for the OWNER side (dispatcher pulls the invite
-- back); 'declined' is the INVITEE saying no.
--
-- The partners-invite-respond edge function uses this when decision='decline'.
-- =============================================================================

alter type partner_invite_status add value if not exists 'declined';
