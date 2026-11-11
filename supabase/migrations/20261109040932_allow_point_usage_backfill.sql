-- Historical receipts prove the amount and time, but not the old wallet balance.
alter table public.rpgenius_point_usage
    alter column balance_before drop not null,
    alter column balance_after drop not null,
    add constraint rpgenius_point_usage_balance_evidence_check check (
        (balance_before is not null and balance_after is not null)
        or (source = 'backfill' and balance_before is null and balance_after is null)
    );

create or replace function public.rpgenius_point_usage_report(
    p_from timestamptz, p_to timestamptz, p_kind text default 'consumption',
    p_category text default null, p_search text default null,
    p_offset integer default 0, p_admin_ids text[] default '{}'::text[]
) returns jsonb language sql stable security invoker set search_path = '' as $$
with filtered as materialized (
    select * from public.rpgenius_point_usage
    where occurred_at >= p_from and occurred_at < p_to
      and (p_kind is null or kind = p_kind)
      and (p_category is null or category = p_category)
      and not is_admin
      and category <> 'mail' and kind <> 'transfer'
      and not (user_id = any(p_admin_ids))
      and (p_search is null or strpos(lower(nickname), lower(p_search)) > 0
           or strpos(lower(product_name), lower(p_search)) > 0 or user_id = p_search)
), daily as (
    select (occurred_at at time zone 'Asia/Seoul')::date as date,
        sum(amount) as amount, count(*) as count, count(distinct user_id) as users
    from filtered group by 1
), categories as (
    select category, sum(amount) as amount, count(*) as count, count(distinct user_id) as users
    from filtered group by category
), products as (
    select category, action, product_id, product_name, sum(amount) as amount,
        sum(quantity) as quantity, count(*) as count, count(distinct user_id) as users
    from filtered group by category, action, product_id, product_name
), entries as (
    select * from filtered order by occurred_at desc, id limit 50 offset greatest(0, p_offset)
)
select jsonb_build_object(
    'summary', (select jsonb_build_object('amount', coalesce(sum(amount),0), 'count', count(*),
        'users', count(distinct user_id), 'paidCount', count(*) filter (where amount > 0), 'recoveredCount', count(*) filter (where source = 'backfill')) from filtered),
    'daily', coalesce((select jsonb_agg(to_jsonb(d) order by date) from daily d), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(to_jsonb(c) order by amount desc) from categories c), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(p) order by amount desc) from products p), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(to_jsonb(e) order by occurred_at desc, id) from entries e), '[]'::jsonb),
    'firstRecordedAt', (select min(occurred_at) from public.rpgenius_point_usage where not is_admin and category <> 'mail' and kind <> 'transfer' and not (user_id = any(p_admin_ids)))
);
$$;
revoke all on function public.rpgenius_point_usage_report(timestamptz,timestamptz,text,text,text,integer,text[]) from public, anon, authenticated;
grant execute on function public.rpgenius_point_usage_report(timestamptz,timestamptz,text,text,text,integer,text[]) to service_role;
