-- =========================================
-- REACTION MASTER オンラインランキング（Supabase 用）
-- Supabase の「SQL Editor」にこのファイルの中身を貼り付けて「Run」する。
-- 何度実行しても同じ状態になる（作り直し可能）。
-- =========================================

-- プレイヤーごと・モードごとの自己ベスト（1人1モード1行）
create table if not exists public.ranking_best (
  mode        text        not null check (mode in ('speed', 'mind')),
  player_id   uuid        not null,
  name        text        not null check (char_length(name) between 1 and 12),
  avg_ms      numeric(7,1) not null,
  times       int[]       not null,
  achieved_at timestamptz not null default now(),
  primary key (mode, player_id)
);
create index if not exists ranking_best_order on public.ranking_best (mode, avg_ms, achieved_at);

-- テーブルへの直接の読み書きは禁止（下の関数経由でのみ操作できる）
alter table public.ranking_best enable row level security;
revoke all on public.ranking_best from anon, authenticated;

-- 名前の整形（制御文字を除去・空白をまとめる・12文字まで）
create or replace function public.ranking_clean_name(p_name text)
returns text language sql immutable as $$
  select left(btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'), '\s+', ' ', 'g')), 12);
$$;

-- 記録の送信：1回ごとの反応時間を受け取り、サーバー側で検証・平均を計算する
create or replace function public.submit_score(p_mode text, p_player uuid, p_name text, p_times int[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name     text := public.ranking_clean_name(p_name);
  v_count    int  := coalesce(array_length(p_times, 1), 0);
  v_max      int;
  v_avg      numeric(7,1);
  v_prev     numeric(7,1);
  v_improved boolean := false;
  v_best     numeric(7,1);
  v_at       timestamptz;
  v_pos      bigint;
  v_total    bigint;
begin
  -- モード別の条件（ゲーム側の RANKING_MODES と同じ値）
  if p_mode = 'speed' then
    v_max := 10000;          -- SPEED TEST：20回（ミス0のプレイのみ送信される）
  elsif p_mode = 'mind' then
    v_max := 1500;           -- MIND GAME：緑10回＋黄10回（黄は1回目のタップまで）。赤は含めない
  else
    raise exception 'invalid mode';
  end if;
  if p_player is null then raise exception 'invalid player'; end if;
  if v_name = '' then raise exception 'invalid name'; end if;
  if v_count <> 20 then raise exception 'invalid times'; end if;
  if exists (select 1 from unnest(p_times) t where t is null or t < 100 or t > v_max) then
    raise exception 'invalid times';
  end if;

  v_avg := round((select avg(t) from unnest(p_times) t)::numeric, 1);

  select avg_ms into v_prev from ranking_best where mode = p_mode and player_id = p_player;
  if v_prev is null or v_avg < v_prev then
    insert into ranking_best (mode, player_id, name, avg_ms, times, achieved_at)
    values (p_mode, p_player, v_name, v_avg, p_times, now())
    on conflict (mode, player_id) do update
      set name = excluded.name, avg_ms = excluded.avg_ms, times = excluded.times, achieved_at = excluded.achieved_at;
    v_improved := true;
  else
    update ranking_best set name = v_name where mode = p_mode and player_id = p_player;
  end if;

  select avg_ms, achieved_at into v_best, v_at from ranking_best where mode = p_mode and player_id = p_player;
  -- 順位：平均が短い順。同タイムは先に記録した人が上
  select count(*) + 1 into v_pos from ranking_best
   where mode = p_mode and (avg_ms < v_best or (avg_ms = v_best and achieved_at < v_at));
  select count(*) into v_total from ranking_best where mode = p_mode;

  return json_build_object('improved', v_improved, 'avg', v_avg, 'best', v_best,
                           'position', v_pos, 'total', v_total);
end;
$$;

-- ランキングの取得：上位 p_limit 人＋（圏外なら）自分の行。プレイヤーIDは返さない
create or replace function public.get_ranking(p_mode text, p_player uuid default null, p_limit int default 50)
returns table (pos bigint, name text, avg_ms numeric, total bigint, is_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select row_number() over (order by b.avg_ms, b.achieved_at) as pos,
           b.name, b.avg_ms, count(*) over () as total,
           (b.player_id = p_player) as is_me
      from ranking_best b
     where b.mode = p_mode
  )
  select pos, name, avg_ms, total, coalesce(is_me, false)
    from ranked
   where pos <= least(greatest(coalesce(p_limit, 50), 1), 100) or is_me
   order by pos;
$$;

-- 名前の変更（全モードの記録に反映）
create or replace function public.rename_player(p_player uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := public.ranking_clean_name(p_name);
begin
  if v_name = '' then raise exception 'invalid name'; end if;
  update ranking_best set name = v_name where player_id = p_player;
end;
$$;

-- ブラウザ（anon）から呼べるのは次の3つの関数だけ
revoke all on function public.submit_score(text, uuid, text, int[]) from public;
revoke all on function public.get_ranking(text, uuid, int) from public;
revoke all on function public.rename_player(uuid, text) from public;
grant execute on function public.submit_score(text, uuid, text, int[]) to anon, authenticated;
grant execute on function public.get_ranking(text, uuid, int) to anon, authenticated;
grant execute on function public.rename_player(uuid, text) to anon, authenticated;
