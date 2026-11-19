-- Demo data for the prototype: one tenant, one live series (code SECRETS01) with 30 episodes, three coin packs.
-- Replace the video URLs with your own files before testing in WhatsApp:
--   * trailer_video_url / wa_video_url_*: public MP4 links (H.264 + AAC, under 16 MB), e.g. Supabase Storage public bucket
--   * stream_uid: the video id from Cloudflare Stream

insert into tenants (slug, name, brand)
values ('watchat', 'Watchat', '{"primary": "#E4572E", "logo": null}')
on conflict (slug) do nothing;

insert into series (tenant_id, code, title_ar, title_en, synopsis_ar, synopsis_en, status, free_web_until_ep, paywall_ep, coins_per_episode, season_pass_price_aed, season_pass_price_sar)
select id, 'SECRETS01',
       'أسرار البيت', 'Secrets of the House',
       'عائلة واحدة، بيت واحد، وسرّ ما أحد يبيه ينكشف.',
       'One family, one house, and a secret nobody wants out.',
       'live', 9, 10, 30, 29.00, 29.00
from tenants where slug = 'watchat'
on conflict (tenant_id, code) do nothing;

insert into episodes (series_id, number, title_ar, title_en, duration_s, status)
select s.id, n, 'الحلقة ' || n, 'Episode ' || n, 90, 'live'
from series s, generate_series(1, 30) as n
where s.code = 'SECRETS01'
on conflict (series_id, number) do nothing;

insert into coin_packs (tenant_id, coins, bonus_coins, price_aed, price_sar, sort)
select t.id, p.coins, p.bonus, p.aed, p.sar, p.sort
from tenants t,
     (values (200, 0, 19.00, 19.00, 1), (500, 50, 39.00, 39.00, 2), (1200, 200, 79.00, 79.00, 3)) as p(coins, bonus, aed, sar, sort)
where t.slug = 'watchat'
  and not exists (select 1 from coin_packs c where c.tenant_id = t.id);
