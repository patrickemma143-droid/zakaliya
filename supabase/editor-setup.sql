-- =====================================================================================
-- Zakaliya website editor: everything the editor needs, set up from the Supabase SQL Editor.
-- Run this whole file once (Supabase > SQL Editor > New query > paste > Run).
-- It is safe to run again later (for example after an update): it replaces the functions
-- and keeps your list of editors.
--
-- What it does:
--   * public.website_editors   the list of people allowed to edit (email + name shown in history)
--   * editor_load / editor_upload / editor_save   called by the editor at zakaliyasbm-mn.com/admin
--     after sign-in. They check the person is on the list, then read and save the website
--     content in GitHub with the key kept in Supabase Vault (secret name: github_token).
-- Editors may only change content/site.yml, content/verses.yml, existing content/pages/*.yml,
-- content/projects/*.yml (add/remove) and add new photos under assets/uploads/.
-- =====================================================================================

create extension if not exists http with schema extensions;

-- The people allowed to edit. Add someone:  insert into public.website_editors (email, name) values ('a@b.com', 'Grace');
create table if not exists public.website_editors (
  email    text primary key check (email = lower(email)),
  name     text,
  added_at timestamptz not null default now()
);
alter table public.website_editors enable row level security;   -- not readable or writable from the website
revoke all on public.website_editors from anon, authenticated;

-- GitHub calls take a few seconds; allow editor requests up to 60 seconds.
alter role authenticated set statement_timeout = '60s';

-- ------------------------------------------------------------------ internal helpers

-- Calls the GitHub API with the key from Vault. Returns {"status": 200, "body": {...}}.
create or replace function public.zk_github(p_method text, p_path text, p_body jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_res   record;
  v_body  jsonb;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'github_token' limit 1;
  if coalesce(v_token, '') = '' then
    raise exception 'The editor is not connected to GitHub yet: add the GitHub key to Supabase Vault with the name github_token.'
      using errcode = 'ZK503';
  end if;
  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '25000');
  exception when others then
    perform set_config('http.timeout_msec', '25000', true);
  end;
  select status, content into v_res from extensions.http((
    p_method::extensions.http_method,
    case when p_path like 'https://%' then p_path else 'https://api.github.com' || p_path end,
    array[
      extensions.http_header('Authorization', 'Bearer ' || v_token),
      extensions.http_header('Accept', 'application/vnd.github+json'),
      extensions.http_header('X-GitHub-Api-Version', '2022-11-28'),
      extensions.http_header('User-Agent', 'zakaliya-website-editor')
    ],
    case when p_body is null then null else 'application/json' end,
    case when p_body is null then null else p_body::text end
  )::extensions.http_request);
  begin
    v_body := nullif(v_res.content, '')::jsonb;
  exception when others then
    v_body := null;
  end;
  return jsonb_build_object('status', v_res.status, 'body', v_body);
end
$$;

-- Who is signed in, and are they on the list of editors?
create or replace function public.zk_editor()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_name  text;
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.' using errcode = 'ZK401';
  end if;
  select name into v_name from public.website_editors where email = v_email;
  if not found then
    raise exception 'This account is not on the list of website editors. Ask the website admin to add it.' using errcode = 'ZK403';
  end if;
  -- The repository is public, so the email address is never written into the history.
  return jsonb_build_object('email', v_email, 'name', coalesce(nullif(trim(v_name), ''), 'Website editor'));
end
$$;

-- Which files the editor may change
create or replace function public.zk_allowed_path(p_path text, p_is_new boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_path ~ '^content/projects/[a-z0-9][a-z0-9-]{0,80}\.yml$'
      or (not p_is_new and p_path ~ '^content/((site|verses)\.yml|pages/[a-z0-9-]+\.yml)$');
$$;

create or replace function public.zk_github_error(p_res jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_res #>> '{body,message}', p_res #>> '{body,errors,0,message}', 'HTTP ' || (p_res ->> 'status'));
$$;

-- ------------------------------------------------------------------ called by the editor

-- Everything the editor needs: the form definitions (.pages.yml), every content file with its
-- version id, and the list of photos. The editor sorts it out.
create or replace function public.editor_load()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  jsonb := public.zk_editor();
  v_res jsonb;
begin
  v_res := public.zk_github('POST', '/graphql', jsonb_build_object('query', $q$
    query {
      repository(owner: "patrickemma143-droid", name: "zakaliya") {
        ref(qualifiedName: "refs/heads/main") { target { oid } }
        schema: object(expression: "main:.pages.yml") { ... on Blob { text oid } }
        content: object(expression: "main:content") { ... on Tree { entries { name type oid object {
          ... on Blob { text oid }
          ... on Tree { entries { name type oid object { ... on Blob { text oid } } } } } } } }
        assets: object(expression: "main:assets") { ... on Tree { entries { name type object {
          ... on Tree { entries { name type } } } } } }
      }
    }$q$));
  if (v_res ->> 'status')::int <> 200 or v_res #> '{body,data,repository,schema,text}' is null then
    raise exception 'Could not load the website content from GitHub (%). Check the github_token secret in Supabase Vault.',
      public.zk_github_error(v_res) using errcode = 'ZK502';
  end if;
  return jsonb_build_object('ok', true, 'name', v_me ->> 'name', 'repository', v_res #> '{body,data,repository}');
end
$$;

-- A photo (already shrunk by the editor, base64). Stored in GitHub; it becomes part of the
-- website only when the page that uses it is saved.
create or replace function public.editor_upload(p_name text, p_data text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   jsonb := public.zk_editor();
  v_data text := regexp_replace(coalesce(p_data, ''), '^data:[^,]*,', '');
  v_head bytea;
  v_ext  text;
  v_base text;
  v_file text;
  v_size bigint;
  v_res  jsonb;
begin
  if v_data = '' or v_data !~ '^[A-Za-z0-9+/=]+$' then
    raise exception 'The photo did not arrive. Please try again.' using errcode = 'ZK400';
  end if;
  v_size := (length(v_data) * 3) / 4;
  if v_size > 12 * 1024 * 1024 then
    raise exception 'That photo is too large. Please use a photo under 12 MB.' using errcode = 'ZK400';
  end if;
  v_head := decode(substr(v_data, 1, 24), 'base64');
  if get_byte(v_head, 0) = 255 and get_byte(v_head, 1) = 216 and get_byte(v_head, 2) = 255 then v_ext := 'jpg';
  elsif substr(v_head, 1, 4) = '\x89504e47'::bytea then v_ext := 'png';
  elsif substr(v_head, 1, 4) = 'RIFF'::bytea and substr(v_head, 9, 4) = 'WEBP'::bytea then v_ext := 'webp';
  else
    raise exception 'Please upload a JPG, PNG or WebP photo.' using errcode = 'ZK400';
  end if;
  v_base := left(trim(both '-' from regexp_replace(lower(regexp_replace(coalesce(p_name, ''), '\.[^.]*$', '')), '[^a-z0-9]+', '-', 'g')), 48);
  v_base := coalesce(nullif(trim(both '-' from v_base), ''), 'photo');
  v_file := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6) || '.' || v_ext;
  v_res := public.zk_github('POST', '/repos/patrickemma143-droid/zakaliya/git/blobs',
                            jsonb_build_object('content', v_data, 'encoding', 'base64'));
  if (v_res ->> 'status')::int <> 201 then
    raise exception 'Could not store the photo in GitHub (%).', public.zk_github_error(v_res) using errcode = 'ZK502';
  end if;
  return jsonb_build_object('ok', true, 'path', '/assets/uploads/' || v_file, 'sha', v_res #>> '{body,sha}', 'size', v_size);
end
$$;

-- Save: one GitHub commit with every changed file and new photo. Refuses to overwrite a file
-- someone else changed since it was opened.
create or replace function public.editor_save(p_changes jsonb default '[]', p_deletes jsonb default '[]',
                                              p_uploads jsonb default '[]', p_summary text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      jsonb := public.zk_editor();
  v_repo    text := '/repos/patrickemma143-droid/zakaliya';
  v_entries jsonb := '[]';
  v_expect  jsonb := '{}';
  v_item    jsonb;
  v_path    text;
  v_text    text;
  v_oid     text;
  v_sha     text;
  v_now     text;
  v_current jsonb;
  v_res     jsonb;
  v_head    text;
  v_tree    text;
  v_newtree text;
  v_commit  text;
  v_who     text;
  v_message text;
  v_status  int;
begin
  p_changes := coalesce(p_changes, '[]'); p_deletes := coalesce(p_deletes, '[]'); p_uploads := coalesce(p_uploads, '[]');
  if jsonb_array_length(p_changes) + jsonb_array_length(p_deletes) = 0 then
    raise exception 'Nothing to save.' using errcode = 'ZK400';
  end if;
  if jsonb_array_length(p_changes) + jsonb_array_length(p_deletes) > 20 or jsonb_array_length(p_uploads) > 60 then
    raise exception 'Too many changes at once. Please save in smaller steps.' using errcode = 'ZK400';
  end if;

  for v_item in select value from jsonb_array_elements(p_changes) loop
    v_path := coalesce(v_item ->> 'path', '');
    v_text := coalesce(v_item ->> 'text', '');
    v_oid  := nullif(v_item ->> 'oid', '');
    if not public.zk_allowed_path(v_path, v_oid is null) then
      raise exception 'That file can not be changed from the editor: %', v_path using errcode = 'ZK403';
    end if;
    if v_text = '' or length(v_text) > 300000 then
      raise exception 'The content of % is empty or not valid.', v_path using errcode = 'ZK400';
    end if;
    v_entries := v_entries || jsonb_build_array(jsonb_build_object('path', v_path, 'mode', '100644', 'type', 'blob', 'content', v_text));
    v_expect  := v_expect || jsonb_build_object(v_path, to_jsonb(v_oid));
  end loop;

  for v_item in select value from jsonb_array_elements(p_deletes) loop
    v_path := coalesce(v_item ->> 'path', '');
    v_oid  := nullif(v_item ->> 'oid', '');
    if v_path !~ '^content/projects/[a-z0-9][a-z0-9-]{0,80}\.yml$' or v_oid is null then
      raise exception 'Only projects can be removed.' using errcode = 'ZK403';
    end if;
    v_entries := v_entries || jsonb_build_array(jsonb_build_object('path', v_path, 'mode', '100644', 'type', 'blob', 'sha', null));
    v_expect  := v_expect || jsonb_build_object(v_path, to_jsonb(v_oid));
  end loop;

  for v_item in select value from jsonb_array_elements(p_uploads) loop
    v_path := regexp_replace(coalesce(v_item ->> 'path', ''), '^/', '');
    v_sha  := coalesce(v_item ->> 'sha', '');
    if v_path !~ '^assets/uploads/[a-z0-9-]+\.(jpg|png|webp)$' or v_sha !~ '^[0-9a-f]{40}$' then
      raise exception 'A photo upload is not valid. Please upload it again.' using errcode = 'ZK400';
    end if;
    v_entries := v_entries || jsonb_build_array(jsonb_build_object('path', v_path, 'mode', '100644', 'type', 'blob', 'sha', v_sha));
  end loop;

  v_who := v_me ->> 'name';
  v_message := 'Website edit: '
    || coalesce(nullif(left(trim(regexp_replace(coalesce(p_summary, ''), '[[:cntrl:]]', ' ', 'g')), 200), ''),
                (select string_agg(k, ', ') from jsonb_object_keys(v_expect) as k))
    || ' (' || v_who || ')';

  for attempt in 1..3 loop
    v_res := public.zk_github('GET', v_repo || '/git/ref/heads/main');
    if (v_res ->> 'status')::int <> 200 then
      raise exception 'Could not reach GitHub (%). Please try again.', public.zk_github_error(v_res) using errcode = 'ZK502';
    end if;
    v_head := v_res #>> '{body,object,sha}';
    v_res := public.zk_github('GET', v_repo || '/git/commits/' || v_head);
    v_tree := v_res #>> '{body,tree,sha}';
    if v_tree is null then
      raise exception 'Could not read the latest version from GitHub. Please try again.' using errcode = 'ZK502';
    end if;

    -- Has someone else changed one of these files in the meantime?
    v_res := public.zk_github('GET', v_repo || '/git/trees/' || v_tree || '?recursive=1');
    if (v_res ->> 'status')::int <> 200 then
      raise exception 'Could not check the latest version on GitHub. Please try again.' using errcode = 'ZK502';
    end if;
    select coalesce(jsonb_object_agg(e ->> 'path', e ->> 'sha'), '{}') into v_current
      from jsonb_array_elements(v_res #> '{body,tree}') e
     where v_expect ? (e ->> 'path');
    for v_path, v_oid in select key, value #>> '{}' from jsonb_each(v_expect) loop
      v_now := v_current ->> v_path;
      if v_oid is null and v_now is not null then
        raise exception 'A project with this name already exists. Please choose a different name.' using errcode = 'ZK409', hint = v_path;
      end if;
      if v_oid is not null and v_now is distinct from v_oid then
        raise exception 'Someone else saved changes to this page while you were editing. Reload to get the latest version, then make your change again.'
          using errcode = 'ZK409', hint = v_path;
      end if;
    end loop;

    v_res := public.zk_github('POST', v_repo || '/git/trees', jsonb_build_object('base_tree', v_tree, 'tree', v_entries));
    v_newtree := v_res #>> '{body,sha}';
    if (v_res ->> 'status')::int <> 201 or v_newtree is null then
      raise exception 'GitHub did not accept the changes (%).', public.zk_github_error(v_res) using errcode = 'ZK502';
    end if;
    v_res := public.zk_github('POST', v_repo || '/git/commits', jsonb_build_object(
      'message', v_message,
      'tree', v_newtree,
      'parents', jsonb_build_array(v_head),
      'author', jsonb_build_object('name', v_who || ' (website editor)', 'email', 'website-editor@zakaliyasbm-mn.com',
                                   'date', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
    v_commit := v_res #>> '{body,sha}';
    if (v_res ->> 'status')::int <> 201 or v_commit is null then
      raise exception 'GitHub did not accept the changes (%).', public.zk_github_error(v_res) using errcode = 'ZK502';
    end if;
    v_res := public.zk_github('PATCH', v_repo || '/git/refs/heads/main', jsonb_build_object('sha', v_commit, 'force', false));
    v_status := (v_res ->> 'status')::int;
    if v_status = 200 then
      return jsonb_build_object('ok', true, 'commit', v_commit);
    end if;
    if v_status not in (409, 422) then
      raise exception 'GitHub did not accept the changes (%).', public.zk_github_error(v_res) using errcode = 'ZK502';
    end if;
    -- Someone else saved at the same moment: start again from their version.
  end loop;
  raise exception 'GitHub is busy. Please click Save again.' using errcode = 'ZK503';
end
$$;

-- ------------------------------------------------------------------ who may call what

revoke all on function public.zk_github(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.zk_editor() from public, anon, authenticated;
revoke all on function public.zk_allowed_path(text, boolean) from public, anon, authenticated;
revoke all on function public.zk_github_error(jsonb) from public, anon, authenticated;
revoke all on function public.editor_load() from public, anon;
revoke all on function public.editor_upload(text, text) from public, anon;
revoke all on function public.editor_save(jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.editor_load() to authenticated;
grant execute on function public.editor_upload(text, text) to authenticated;
grant execute on function public.editor_save(jsonb, jsonb, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
