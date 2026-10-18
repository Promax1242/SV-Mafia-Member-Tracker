-- All application tables are private. Only the authenticated Edge API can invoke the service RPC.
create schema if not exists sv_private;
revoke all on schema sv_private from public, anon, authenticated;
create table sv_private.members (
 discord_id text primary key check(discord_id ~ '^[0-9]{15,22}$'),
 user_id uuid unique references auth.users(id),
 access text not null default 'member' check(access in ('member','staff','developer')),
 reset_pending boolean not null default false,
 payload jsonb not null,
 check(access <> 'developer' or discord_id='772822130236719136')
);
create table sv_private.records (kind text not null, id text not null, payload jsonb not null, primary key(kind,id));
create table sv_private.activations (
 discord_id text primary key references sv_private.members(discord_id) on delete cascade,
 hash text not null, expires timestamptz not null, state text not null default 'pending' check(state in ('pending','processing','used')),
 claim uuid, provision_user_id uuid, reset boolean not null default false
);
create table sv_private.audit (id bigint generated always as identity primary key, at timestamptz not null default now(), actor text not null, action text not null, target text, member_id text);
create table sv_private.rate_limits (key text primary key, window_start timestamptz not null default now(), hits int not null default 1);
alter table sv_private.members enable row level security;
alter table sv_private.records enable row level security;
alter table sv_private.activations enable row level security;
alter table sv_private.audit enable row level security;
alter table sv_private.rate_limits enable row level security;
revoke all on all tables in schema sv_private from public,anon,authenticated;

create function sv_private.api(op text, body jsonb, actor uuid, session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me sv_private.members; target sv_private.members; a sv_private.activations; c jsonb; v jsonb; old jsonb; k text; rid text; did text; result jsonb; n int; claim_id uuid;
begin
 -- Serialise portal mutations; compare-before-write prevents lost edits across devices.
 perform pg_advisory_xact_lock(194850021);
 if op='limit' then
  insert into sv_private.rate_limits(key) values(body->>'key') on conflict(key) do update
   set hits=case when sv_private.rate_limits.window_start < now()-interval '10 minutes' then 1 else sv_private.rate_limits.hits+1 end,
   window_start=case when sv_private.rate_limits.window_start < now()-interval '10 minutes' then now() else sv_private.rate_limits.window_start end returning hits into n;
  delete from sv_private.rate_limits where window_start<now()-interval '1 day';
  return to_jsonb(n <= (body->>'max')::int);
 end if;
 if op='request' then
  did:=body->>'id';
  if did='772822130236719136' or exists(select 1 from sv_private.members where discord_id=did) then return '{"ok":true}'; end if;
  insert into sv_private.records(kind,id,payload) values('requests',did,body) on conflict do nothing;
  return '{"ok":true}';
 end if;
 if op='claim' then
  did:=body->>'id';
  select * into target from sv_private.members where discord_id=did;
  select * into a from sv_private.activations where discord_id=did for update;
  if target.discord_id is null or target.payload->>'status'<>'Active' or a.state<>'pending' or a.expires<now() or a.hash is distinct from body->>'hash'
   or exists(select 1 from sv_private.records where kind='blacklist' and payload->>'discordId'=did) then raise exception 'Invalid or expired activation code'; end if;
  claim_id:=gen_random_uuid();
  update sv_private.activations set state='processing',claim=claim_id,provision_user_id=coalesce(target.user_id,gen_random_uuid()) where discord_id=did returning * into a;
  return jsonb_build_object('claim',claim_id,'userId',target.user_id,'provisionId',a.provision_user_id,'reset',a.reset);
 end if;
 if op in ('finish','release') then
  did:=body->>'id'; select * into a from sv_private.activations where discord_id=did for update;
  if a.state<>'processing' or a.claim is distinct from (body->>'claim')::uuid then raise exception 'Invalid claim'; end if;
  if op='release' then
   update sv_private.activations set state='pending',claim=null where discord_id=did;
  else
   update sv_private.members set user_id=(body->>'userId')::uuid,reset_pending=false where discord_id=did;
   -- Password resets immediately invalidate existing sessions, including unexpired access tokens.
   delete from auth.sessions where user_id=(body->>'userId')::uuid;
   update sv_private.activations set state='used',claim=null where discord_id=did;
   insert into sv_private.audit(actor,action,target,member_id) values(did,case when a.reset then 'Password reset completed' else 'Account activated' end,did,did);
  end if;
  return '{"ok":true}';
 end if;
 select * into me from sv_private.members where user_id=actor;
 if me.discord_id is null or me.reset_pending or me.payload->>'status'<>'Active'
  or not exists(select 1 from auth.sessions s where s.id=session and s.user_id=actor and (s.not_after is null or s.not_after>now()))
  or exists(select 1 from sv_private.records where kind='blacklist' and payload->>'discordId'=me.discord_id) then raise exception 'Account unavailable or session expired'; end if;
 if op='load' then
  select coalesce(jsonb_agg(payload order by payload->>'name'),'[]') into v from sv_private.members;
  result:=jsonb_build_object('me',me.discord_id,'access',me.access,'data',jsonb_build_object('members',v));
  foreach k in array array['roles','events','warnings','loas','blacklist','announcements','requests'] loop
   select coalesce(jsonb_agg(r.payload order by r.id),'[]') into v from sv_private.records r where r.kind=k and (
    k in ('roles','events') or
    (k in ('warnings','loas') and (me.access<>'member' or r.payload->>'memberId'=me.discord_id)) or
    (k in ('blacklist','requests') and me.access<>'member') or
    (k='announcements' and (me.access<>'member' or r.payload->>'audience'='all' or
      (r.payload->>'audience'='vpl' and (me.payload->'role' ?| array['VPL Main Line','VPL Roster'])) or
      (r.payload->>'audience'='mafia' and (me.payload->'role' ?| array['Mafia','Mafia (Leadership)'])))));
   result:=jsonb_set(result,array['data',k],v);
  end loop;
  select coalesce(jsonb_object_agg(id,payload),'{}') into v from sv_private.records where kind='attendance' and (me.access<>'member' or payload->>'memberId'=me.discord_id);
  result:=result||jsonb_build_object('attendance',v);
  if me.access<>'member' then
   select coalesce(jsonb_object_agg(discord_id,jsonb_build_object('expires',extract(epoch from expires)*1000,'used',state='used','state',state)),'{}') into v from sv_private.activations;
   result:=result||jsonb_build_object('codes',v);
   select coalesce(jsonb_object_agg(discord_id,true),'{}') into v from sv_private.members where user_id is not null;
   result:=result||jsonb_build_object('accounts',v);
  end if;
  if me.access='developer' then
   select coalesce(jsonb_agg(x),'[]') into v from (select audit_entry.id::text,audit_entry.at,audit_entry.actor,audit_entry.action,audit_entry.target,audit_entry.member_id as "memberId" from sv_private.audit audit_entry order by audit_entry.id desc limit 5000) x;
   result:=result||jsonb_build_object('activity',v);
  end if;
  return result;
 end if;
 if op='attendance' then
  rid:=body->>'eventId';
  if not exists(select 1 from sv_private.records where kind='events' and id=rid) then raise exception 'Event not found'; end if;
  if body->>'response' not in ('Attended','Missed','Unsure') then raise exception 'Invalid response'; end if;
  v:=jsonb_build_object('eventId',rid,'memberId',me.discord_id,'response',body->>'response','at',now());
  insert into sv_private.records values('attendance',rid||':'||me.discord_id,v) on conflict(kind,id) do update set payload=excluded.payload;
 elsif op in ('issue','revoke','promote') then
  did:=body->>'id'; select * into target from sv_private.members where discord_id=did;
  if me.access='member' or target.discord_id is null or target.access='developer' or (target.access='staff' and me.access<>'developer') then raise exception 'Permission denied'; end if;
  if op='promote' then
   if me.access<>'developer' then raise exception 'Developer only'; end if;
   update sv_private.members set access=case when (body->>'enabled')::boolean then 'staff' else 'member' end,
    payload=jsonb_set(payload,'{role}',(select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(payload->'role') x where x<>'"Leadership"'::jsonb)||case when (body->>'enabled')::boolean then '["Leadership"]'::jsonb else '[]'::jsonb end) where discord_id=did;
  elsif op='revoke' then
   delete from sv_private.activations where discord_id=did and state<>'processing';
  else
   if exists(select 1 from sv_private.activations where discord_id=did and state='processing') then raise exception 'Activation in progress'; end if;
   if target.payload->>'status'<>'Active' then raise exception 'Member must be active'; end if;
   insert into sv_private.activations(discord_id,hash,expires,reset) values(did,body->>'hash',now()+interval '24 hours',target.user_id is not null)
    on conflict(discord_id) do update set hash=excluded.hash,expires=excluded.expires,state='pending',claim=null,reset=excluded.reset;
   if target.user_id is not null then
    update sv_private.members set reset_pending=true where discord_id=did;
    delete from auth.sessions where user_id=target.user_id;
   end if;
  end if;
  insert into sv_private.audit(actor,action,target,member_id) values(me.discord_id,op,did,did);
 elsif op='mutate' then
  for c in select * from jsonb_array_elements(body->'changes') loop
   k:=c->>'kind';rid:=c->>'id'; v:=nullif(c->'value','null'::jsonb); old:=null;
   if me.access='member' or k not in ('members','roles','events','warnings','loas','blacklist','announcements','requests') then raise exception 'Permission denied'; end if;
   if k in ('roles','announcements') and me.access<>'developer' then raise exception 'Developer only'; end if;
   if k='members' then
    select * into target from sv_private.members where discord_id=rid;
    old:=target.payload;
    if (rid='772822130236719136' and (me.access<>'developer' or v is null or v->>'status'<>'Active')) or (target.access='staff' and me.access<>'developer') then raise exception 'Protected account'; end if;
    if v is not null and ((coalesce(v->'role','[]') ? 'Developer') is distinct from (coalesce(old->'role','[]') ? 'Developer') or (coalesce(v->'role','[]') ? 'Leadership') is distinct from (coalesce(old->'role','[]') ? 'Leadership')) then raise exception 'Use Developer Leadership Access to change permissions'; end if;
   else select payload into old from sv_private.records where kind=k and id=rid;
   end if;
   if old is distinct from nullif(c->'before','null'::jsonb) then raise exception 'Record changed on another device. Refresh and try again.'; end if;
   if k='roles' and (rid in ('Developer','Leadership') or v->>'name' in ('Developer','Leadership')) then raise exception 'Reserved role'; end if;
   if k='members' then
    if v is null then
     -- Remove roster access but retain Auth identity for a safe future reactivation.
     update sv_private.members set payload=jsonb_set(payload,'{status}','"Removed"'),reset_pending=true where discord_id=rid;
     delete from sv_private.activations where discord_id=rid;
    else
     insert into sv_private.members(discord_id,payload) values(rid,v) on conflict(discord_id) do update set payload=excluded.payload;
    end if;
   elsif v is null then delete from sv_private.records where kind=k and id=rid;
   else insert into sv_private.records values(k,rid,v) on conflict(kind,id) do update set payload=excluded.payload;
   end if;
   insert into sv_private.audit(actor,action,target,member_id) values(me.discord_id,case when v is null then 'Deleted ' when old is null then 'Created ' else 'Updated ' end||k,rid,case when k='members' then rid else coalesce(v->>'memberId',v->>'discordId') end);
  end loop;
 else raise exception 'Unknown operation';
 end if;
 return '{"ok":true}';
end $$;
revoke all on function sv_private.api(text,jsonb,uuid,uuid) from public,anon,authenticated;
grant usage on schema sv_private to service_role;
grant execute on function sv_private.api(text,jsonb,uuid,uuid) to service_role;
create function public.portal_backend(op text, body jsonb default '{}', actor uuid default null, session uuid default null) returns jsonb
language sql security invoker set search_path='' as $$ select sv_private.api(op,body,actor,session) $$;
revoke all on function public.portal_backend(text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.portal_backend(text,jsonb,uuid,uuid) to service_role;
-- Prevent unapproved direct Auth signups and synthetic-email account squatting.
create function sv_private.guard_auth_identity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Auth inserts app_metadata in a later step. Bind provisioning to a server-created UUID instead.
 if not exists(select 1 from sv_private.members m left join sv_private.activations a on a.discord_id=m.discord_id
  where new.email=m.discord_id||'@members.sv-mafia.invalid' and
  ((a.state='processing' and a.expires>now() and a.provision_user_id=new.id) or (tg_op='UPDATE' and m.user_id=new.id)))
 then raise exception 'Use an approved PIR activation code'; end if;
 return new;
end $$;
revoke all on function sv_private.guard_auth_identity() from public,anon,authenticated;
create trigger sv_guard_auth before insert or update of email on auth.users for each row execute function sv_private.guard_auth_identity();
