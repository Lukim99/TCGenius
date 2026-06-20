-- =====================================================================
-- chatbot2 Supabase 스키마 (재작성본)
-- 변경점: 채팅 원문을 저장하던 chatbot2_chat_logs 제거 →
--         날짜별 채팅 카운트 집계 테이블 chatbot2_chat_counts 로 전면 교체
-- =====================================================================

-- ---------------------------------------------------------------------
-- (마이그레이션) 더 이상 사용하지 않는 채팅 원문 로그 테이블 제거
-- ---------------------------------------------------------------------
drop table if exists chatbot2_chat_logs;

-- ---------------------------------------------------------------------
-- 유저
-- id = "{channel_id}:{user_id}"
-- ---------------------------------------------------------------------
create table if not exists chatbot2_users (
    id                   text primary key,
    channel_id           text not null,
    user_id              text not null,
    display_nickname     text default '',
    points               bigint default 0,
    attendance_days      integer default 0,
    attendance_streak    integer default 0,
    last_attendance_date text,
    total_chat_count     bigint default 0,
    game_enabled         boolean default true,
    updown_wins          integer default 0,
    choseong_wins        integer default 0,
    baseball_wins        integer default 0,
    last_chat_at         timestamptz,
    last_join_at         timestamptz,
    last_leave_at        timestamptz,
    last_seen_at         timestamptz,
    created_at           timestamptz default now(),
    updated_at           timestamptz default now()
);

create index if not exists idx_chatbot2_users_channel on chatbot2_users (channel_id);

-- 기존 테이블에 컬럼이 없다면 추가
alter table chatbot2_users add column if not exists baseball_wins integer default 0;

-- ---------------------------------------------------------------------
-- 날짜별 채팅 카운트 (chat_logs 대체)
-- id = "{channel_id}:{user_id}:{date}"  (date 는 KST 기준 YYYY-MM-DD)
-- 한 유저의 하루 채팅 수를 한 행으로 누적 기록
-- ---------------------------------------------------------------------
create table if not exists chatbot2_chat_counts (
    id         text primary key,
    channel_id text not null,
    user_id    text not null,
    date       date not null,
    count      bigint default 0,
    updated_at timestamptz default now()
);

create index if not exists idx_chatbot2_chat_counts_channel_date
    on chatbot2_chat_counts (channel_id, date);
create index if not exists idx_chatbot2_chat_counts_channel_user
    on chatbot2_chat_counts (channel_id, user_id);

-- ---------------------------------------------------------------------
-- 채팅 카운트 원자적 증가 RPC
-- 동시 채팅 시 race condition 없이 카운트를 누적한다.
-- ---------------------------------------------------------------------
create or replace function chatbot2_increment_chat_count(
    p_channel_id text,
    p_user_id    text,
    p_date       date,
    p_amount     integer default 1
) returns void
language sql
as $$
    insert into chatbot2_chat_counts (id, channel_id, user_id, date, count, updated_at)
    values (
        p_channel_id || ':' || p_user_id || ':' || p_date,
        p_channel_id, p_user_id, p_date, p_amount, now()
    )
    on conflict (id) do update
        set count = chatbot2_chat_counts.count + p_amount,
            updated_at = now();
$$;

-- ---------------------------------------------------------------------
-- 포인트 상점 아이템
-- id = "{channel_id}:{item_key}"  (item_key = lower(trim(name)))
-- ---------------------------------------------------------------------
create table if not exists chatbot2_shop_items (
    id          text primary key,
    channel_id  text not null,
    item_key    text not null,
    name        text not null,
    price       bigint default 0,
    description text default '',
    is_active   boolean default true,
    created_by  text,
    created_at  timestamptz default now(),
    updated_at  timestamptz default now()
);

create index if not exists idx_chatbot2_shop_items_channel
    on chatbot2_shop_items (channel_id, is_active);

-- ---------------------------------------------------------------------
-- 유저 가방 아이템
-- id = "{channel_id}:{user_id}:{item_key}"
-- ---------------------------------------------------------------------
create table if not exists chatbot2_bag_items (
    id         text primary key,
    channel_id text not null,
    user_id    text not null,
    item_key   text not null,
    item_name  text default '',
    quantity   bigint default 0,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index if not exists idx_chatbot2_bag_items_owner
    on chatbot2_bag_items (channel_id, user_id);

-- ---------------------------------------------------------------------
-- 참고: 닉변기록(/닉변기록)은 공용 테이블 join_leave_logs 를 조회한다.
--       이 테이블은 chatbot2 전용이 아니므로 여기서 정의/변경하지 않는다.
-- ---------------------------------------------------------------------
