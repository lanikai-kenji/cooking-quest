-- ============================================================
--  クッキングクエスト: Supabase セットアップSQL
--  Supabaseダッシュボード → 左メニュー「SQL Editor」→「New query」
--  → 下を全部はりつけて「Run」（1回でOK）
-- ============================================================

-- 1) 記録テーブル（毎日の料理データ）
create table if not exists public.entries (
  id          text primary key,
  ws          text not null,
  day         int,
  date        text,
  title       text,
  ingredients text,
  steps       text,
  note        text,
  stars       int,
  yum         text,
  photos      jsonb not null default '[]'::jsonb,
  created_at  bigint,
  updated_at  bigint
);
create index if not exists entries_ws_idx on public.entries (ws);

-- 2) 設定テーブル（名前・タイトル・はじめに・まとめ 等）
create table if not exists public.app_settings (
  ws          text primary key,
  data        jsonb,
  updated_at  bigint
);

-- 3) RLS 有効化 ＋ 匿名アクセス許可
--    （保護は「URL内の推測不能なワークスペースID」で行う方式）
alter table public.entries      enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists "anon_entries_all" on public.entries;
create policy "anon_entries_all" on public.entries
  for all to anon using (true) with check (true);

drop policy if exists "anon_settings_all" on public.app_settings;
create policy "anon_settings_all" on public.app_settings
  for all to anon using (true) with check (true);

-- 4) 写真用ストレージ（公開読み取り・匿名アップロード可）
insert into storage.buckets (id, name, public)
  values ('photos', 'photos', true)
  on conflict (id) do nothing;

drop policy if exists "photos_anon_insert" on storage.objects;
create policy "photos_anon_insert" on storage.objects
  for insert to anon with check (bucket_id = 'photos');

drop policy if exists "photos_anon_update" on storage.objects;
create policy "photos_anon_update" on storage.objects
  for update to anon using (bucket_id = 'photos') with check (bucket_id = 'photos');

drop policy if exists "photos_public_read" on storage.objects;
create policy "photos_public_read" on storage.objects
  for select to public using (bucket_id = 'photos');

-- （任意）記録を消したとき写真もお片づけできるように
drop policy if exists "photos_anon_delete" on storage.objects;
create policy "photos_anon_delete" on storage.objects
  for delete to anon using (bucket_id = 'photos');

-- 完了！「Success. No rows returned」と出ればOKです。
