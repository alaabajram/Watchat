-- A viewer keeps a separate place in each series' flow (watching several series), plus how the run
-- began (chat code or web), the furthest episode sent in the chat, and when the web entry last fired.
alter table flow_runs drop constraint flow_runs_pkey;
alter table flow_runs add primary key (viewer_id, series_id);
alter table flow_runs drop constraint flow_runs_status_check;
alter table flow_runs add constraint flow_runs_status_check check (status in ('input', 'wait', 'running', 'done', 'blocked', 'paused'));
alter table flow_runs
  add column entry text not null default 'chat' check (entry in ('chat', 'web')),
  add column chat_episode int not null default 0,
  add column web_triggered_at timestamptz;
create index flow_runs_viewer on flow_runs (viewer_id, updated_at desc);
