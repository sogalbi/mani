-- Default settings and the 2026 winter season.
-- Check the official notice before launch: https://www.starbucks.co.kr/whats_new/campaign_view.do?pro_seq=3499
-- Admins can change every value later (admin_set_setting / admin_update_campaign).

insert into public.app_settings (key, value, description) values
  ('claim_hours', '24', '당첨자가 수령 의사·바코드를 입력해야 하는 기본 시간'),
  ('send_hours', '12', '바코드가 준비된 뒤 보내는 사람이 전송 신고해야 하는 시간'),
  ('receipt_hours', '48', '전송 신고 뒤 받는 사람이 수령 확인해야 하는 시간(넘기면 분쟁)'),
  ('swap_accept_hours', '24', '교환 제안에 응답해야 하는 시간'),
  ('manual_select_hours', '48', '직접 선정 나눔에서 마감 후 선정해야 하는 시간'),
  ('barcode_view_limit', '5', '보내는 사람이 바코드를 열람할 수 있는 최대 횟수'),
  ('max_open_posts', '5', '한 사람이 동시에 열어 둘 수 있는 게시글 수'),
  ('max_post_hours', '168', '게시글 모집 기간 최대 시간'),
  ('max_active_swaps', '3', '한 사람이 동시에 진행할 수 있는 교환 수'),
  ('max_reports_per_day', '20', '하루 신고 접수 한도'),
  ('policy_version_terms', '"draft-2026-11"', '이용약관 버전'),
  ('policy_version_privacy', '"draft-2026-11"', '개인정보 처리 안내 버전'),
  ('policy_version_trade_risk', '"draft-2026-11"', '거래 위험 고지 버전'),
  ('policy_version_barcode_provision', '"draft-2026-11"', '바코드 제공 동의 버전'),
  ('levels', '[
    {"level":1,"name":"새싹","min":0,"deco":"기본 새싹"},
    {"level":2,"name":"네잎클로버","min":3,"deco":"작은 클로버"},
    {"level":3,"name":"꽃봉오리","min":10,"deco":"봉오리 머리핀"},
    {"level":4,"name":"꽃송이","min":25,"deco":"꽃 화관"},
    {"level":5,"name":"나무","min":50,"deco":"작은 나뭇잎 망토"},
    {"level":6,"name":"반짝정원","min":100,"deco":"반짝 꽃 장식"}
  ]', '나눔 완료 장수 기준 성장 단계(경쟁·우선권 아님)')
on conflict (key) do nothing;

insert into public.campaigns (slug, name, brand, starts_at, ends_at, status, completion_rule, official_url, notice)
values ('2026_winter', '2026 겨울 e-프리퀀시', '스타벅스',
        '2026-10-22 00:00:00+09', '2027-01-01 00:00:00+09', 'active',
        '{"mission": 3, "total": 17}',
        'https://www.starbucks.co.kr/whats_new/campaign_view.do?pro_seq=3499',
        '미션 스티커 3개를 포함해 총 17개를 모으는 기준이에요. 실제 규칙은 공식 안내를 확인해 주세요.')
on conflict (slug) do nothing;

insert into public.sticker_types (campaign_id, code, name, sort_order)
select c.id, v.code, v.name, v.sort_order
from public.campaigns c,
     (values ('MISSION', '미션', 1), ('GENERAL', '일반', 2)) as v(code, name, sort_order)
where c.slug = '2026_winter'
on conflict (campaign_id, code) do nothing;
