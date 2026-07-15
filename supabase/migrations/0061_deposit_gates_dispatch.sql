-- =============================================================================
-- Deposit gates dispatch (Adam, 2026-07-14).
--
-- Bookings are now created as status='draft' and flip to 'searching' (the
-- crew-visible pool) ONLY when the 20% deposit is confirmed paid by the
-- signature-verified Stripe webhook. The status machine (0006) allowed only
-- draft → pending — add draft → searching so the webhook can dispatch in one
-- auditable transition.
-- =============================================================================

create or replace function enforce_booking_status_transition()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_allowed boolean;
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  -- Admins can override
  if is_admin() then
    return new;
  end if;

  if old.status = new.status then
    return new;
  end if;

  v_allowed := case
    -- draft → searching is the deposit-paid dispatch (stripe-webhook).
    when old.status = 'draft'      and new.status in ('pending', 'searching', 'cancelled') then true
    when old.status = 'pending'    and new.status in ('searching', 'cancelled', 'failed') then true
    when old.status = 'searching'  and new.status in ('assigned', 'cancelled', 'failed') then true
    when old.status = 'assigned'   and new.status in ('confirmed', 'cancelled') then true
    when old.status = 'confirmed'  and new.status in ('on_the_way', 'cancelled') then true
    when old.status = 'on_the_way' and new.status in ('arrived', 'cancelled') then true
    when old.status = 'arrived'    and new.status in ('loading', 'cancelled') then true
    when old.status = 'loading'    and new.status in ('in_transit', 'cancelled') then true
    when old.status = 'in_transit' and new.status in ('unloading', 'cancelled') then true
    when old.status = 'unloading'  and new.status in ('completed', 'cancelled') then true
    else false
  end;

  if not v_allowed then
    raise exception 'Invalid booking status transition: % → %', old.status, new.status
      using errcode = '22023';  -- invalid_parameter_value
  end if;

  return new;
end $$;
