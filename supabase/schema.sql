-- ============================================================
-- Wine Cellar · Supabase 数据库结构 + 权限（RLS）
-- 用法：Supabase 控制台 → SQL Editor → 新建 query → 粘贴本文件全部内容 → Run
-- 可重复运行（幂等）。
-- ============================================================

-- ---------- 1. 表结构 ----------

-- 用户资料：每个注册用户一行，用于展示昵称、加好友
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique,
  display_name text,
  created_at   timestamptz not null default now()
);

-- 酒柜：一个用户可以有多个酒柜；酒柜内容整体存成 JSON（payload）
--   payload 结构 = { base: [...酒], state: {moves,meta,added,finished,opened}, structure: {层架布局} }
create table if not exists public.cellars (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null default '我的酒柜',
  visibility  text not null default 'private'
                check (visibility in ('private','friends','public')),
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists cellars_user_idx on public.cellars(user_id);

-- 好友关系：一行代表一段关系，双向对称
--   status = pending（已发出请求，待对方同意）/ accepted（已互为好友）
create table if not exists public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending'
                 check (status in ('pending','accepted')),
  created_at   timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);
create index if not exists friendships_req_idx on public.friendships(requester_id);
create index if not exists friendships_addr_idx on public.friendships(addressee_id);

-- ---------- 2. 辅助函数 ----------

-- 判断两个用户是否已互为好友（accepted）
create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = a and f.addressee_id = b)
        or (f.requester_id = b and f.addressee_id = a))
  );
$$;

-- 判断两个用户之间是否存在任意好友关系记录（任何状态）——用于能否看到对方昵称
create or replace function public.has_friend_link(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.friendships f
    where (f.requester_id = a and f.addressee_id = b)
       or (f.requester_id = b and f.addressee_id = a)
  );
$$;

-- 注册后自动创建一条 profile（昵称默认取邮箱 @ 前面的部分）
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 通过邮箱发起好友请求（不暴露任何人的邮箱；找不到就返回 not_found）
create or replace function public.request_friend_by_email(target_email text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  target uuid;
begin
  select id into target from auth.users where lower(email) = lower(trim(target_email));
  if target is null then
    return 'not_found';
  end if;
  if target = auth.uid() then
    return 'self';
  end if;
  insert into public.friendships (requester_id, addressee_id, status)
  values (auth.uid(), target, 'pending')
  on conflict (requester_id, addressee_id) do nothing;
  return 'ok';
end;
$$;

-- ---------- 3. 打开行级安全（RLS） ----------

alter table public.profiles    enable row level security;
alter table public.cellars     enable row level security;
alter table public.friendships enable row level security;

-- profiles：能看到自己的，以及与自己有好友关系（含待处理）的人的昵称
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.has_friend_link(auth.uid(), id));

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert
  with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- cellars：本人可看；好友可看设为 friends 的酒柜；任何登录用户可看 public 的
drop policy if exists cellars_select on public.cellars;
create policy cellars_select on public.cellars for select
  using (
    user_id = auth.uid()
    or visibility = 'public'
    or (visibility = 'friends' and public.are_friends(auth.uid(), user_id))
  );

drop policy if exists cellars_insert on public.cellars;
create policy cellars_insert on public.cellars for insert
  with check (user_id = auth.uid());

drop policy if exists cellars_update on public.cellars;
create policy cellars_update on public.cellars for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists cellars_delete on public.cellars;
create policy cellars_delete on public.cellars for delete
  using (user_id = auth.uid());

-- friendships：只能看到与自己相关的关系
drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships for select
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- 只能以自己的身份发起请求
drop policy if exists friendships_insert on public.friendships;
create policy friendships_insert on public.friendships for insert
  with check (requester_id = auth.uid());

-- 关系双方都可以更新（对方同意 / 自己取消）
drop policy if exists friendships_update on public.friendships;
create policy friendships_update on public.friendships for update
  using (requester_id = auth.uid() or addressee_id = auth.uid())
  with check (requester_id = auth.uid() or addressee_id = auth.uid());

-- 关系双方都可以删除（解除好友 / 撤回请求 / 拒绝）
drop policy if exists friendships_delete on public.friendships;
create policy friendships_delete on public.friendships for delete
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- ============================================================
-- 完成。回到应用，用邮箱+密码注册即可。
-- ============================================================
