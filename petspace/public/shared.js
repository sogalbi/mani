/* 브라우저와 서버가 함께 쓰는 값과 검사 함수. 의존성 없이 유지해요. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PS = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BRAND = '멍냥사';

  var SPECIES = [
    { id: 'dog', label: '강아지', treat: 'bone' },
    { id: 'cat', label: '고양이', treat: 'fish' },
    { id: 'rabbit', label: '토끼', treat: 'carrot' },
    { id: 'hamster', label: '햄스터', treat: 'seed' },
    { id: 'bird', label: '새', treat: 'seed' }
  ];

  var COLORS = [
    { id: 'white', label: '하양', fill: '#f4efe6', shade: '#d6ccbe', line: '#8f8476' },
    { id: 'cream', label: '크림', fill: '#ecd3a4', shade: '#cfae78', line: '#8a6c42' },
    { id: 'cheese', label: '치즈', fill: '#e9a35c', shade: '#c67e3c', line: '#7d4a1d' },
    { id: 'brown', label: '갈색', fill: '#9b6b47', shade: '#76502f', line: '#43291a' },
    { id: 'gray', label: '회색', fill: '#a6aab0', shade: '#80858c', line: '#4a4e55' },
    { id: 'black', label: '검정', fill: '#45403d', shade: '#2c2826', line: '#141211' }
  ];

  // g: 'm' 무지개다리를 건넌 아이, 'l' 곁에 있는 아이, 'b' 둘 다
  var WISHES = [
    { text: '보고 싶어', g: 'm' },
    { text: '고마웠어', g: 'm' },
    { text: '별에서 편히 쉬어', g: 'm' },
    { text: '다시 만나자', g: 'm' },
    { text: '이제 아프지 마', g: 'm' },
    { text: '사랑해', g: 'b' },
    { text: '우리 집에 와줘서 고마워', g: 'b' },
    { text: '언제나 함께야', g: 'b' },
    { text: '건강하게 오래오래', g: 'l' },
    { text: '오늘도 고마워', g: 'l' },
    { text: '아프지 말고 행복하자', g: 'l' }
  ];

  var LIMITS = {
    nameMax: 10,
    lanternCooldownMs: 20000,
    treatCooldownMs: 1500,
    lanternTtlMs: 24 * 60 * 60 * 1000
  };

  // 이름에 쓰면 안 되는 말. 띄어쓰기·기호·숫자를 뺀 뒤 포함 여부로 걸러요.
  var BLOCKED = [
    '씨발', '시발', '씨빨', '씨바', 'ㅅㅂ', 'ㅆㅂ', '병신', '븅신', 'ㅂㅅ', '좆', '존나', '졸라',
    '개새', '새끼', 'ㅅㄲ', '섹스', '니미', '느금', '니애미', '엠창', '지랄', 'ㅈㄹ', '염병',
    '닥쳐', '꺼져', '자살', '뒤져', '일베', '메갈', '한남', '김치녀', '틀딱',
    'fuck', 'shit', 'bitch', 'sex', 'porn', 'nigg', 'cunt'
  ];
  var LINKY = /(https?|www\.|\.com|\.net|\.kr|\.io|kakao|카톡|오픈톡|오픈채팅|텔레그램|telegram|토토|카지노|대출)/i;
  var ALLOWED_CHARS = /^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ .\-_~♥♡]+$/;
  var INVISIBLE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]', 'g');

  function cleanName(raw) {
    if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
    var s = raw.normalize ? raw.normalize('NFC') : raw;
    s = s.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
    s = Array.from(s).slice(0, LIMITS.nameMax).join('').trim();
    if (!s) return { ok: false, reason: 'empty' };
    if (!ALLOWED_CHARS.test(s)) return { ok: false, reason: 'chars' };
    if (LINKY.test(s)) return { ok: false, reason: 'blocked' };
    if ((s.match(/[0-9]/g) || []).length >= 4) return { ok: false, reason: 'blocked' };
    var compact = s.toLowerCase().replace(/[\s.\-_~♥♡0-9]/g, '');
    for (var i = 0; i < BLOCKED.length; i++) {
      if (compact.indexOf(BLOCKED[i]) !== -1) return { ok: false, reason: 'blocked' };
    }
    return { ok: true, name: s };
  }

  function findById(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function cleanPet(p) {
    if (!p || typeof p !== 'object') return { ok: false, reason: 'empty' };
    var n = cleanName(p.name);
    if (!n.ok) return n;
    return {
      ok: true,
      pet: {
        name: n.name,
        species: findById(SPECIES, p.species) ? p.species : 'dog',
        color: findById(COLORS, p.color) ? p.color : 'cream',
        memorial: p.memorial === true
      }
    };
  }

  var PUBLIC_ROOM = /^maru-([1-9][0-9]{0,3})$/;
  var ROOM_ID = /^[a-z0-9][a-z0-9-]{0,23}$/;

  function cleanRoomId(r) {
    if (typeof r !== 'string') return null;
    r = r.trim().toLowerCase();
    return ROOM_ID.test(r) ? r : null;
  }

  function isPublicRoom(id) { return PUBLIC_ROOM.test(id || ''); }

  function roomLabel(id) {
    var m = PUBLIC_ROOM.exec(id || '');
    return m ? m[1] + '번 마루' : '우리끼리 마루';
  }

  function wishesFor(memorial) {
    var out = [];
    for (var i = 0; i < WISHES.length; i++) {
      var g = WISHES[i].g;
      if (g === 'b' || (memorial ? g === 'm' : g === 'l')) out.push(i);
    }
    return out;
  }

  function validWish(i, memorial) {
    return typeof i === 'number' && wishesFor(memorial).indexOf(i) !== -1;
  }

  // 받침이 있으면 '이'를 붙여 부르는 이름 (초코 → 초코, 몽실 → 몽실이)
  function hasBatchim(word) {
    var c = (word || '').charCodeAt(word.length - 1);
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 !== 0;
    return false;
  }
  function callName(name) { return hasBatchim(name) ? name + '이' : name; }

  return {
    BRAND: BRAND,
    SPECIES: SPECIES,
    COLORS: COLORS,
    WISHES: WISHES,
    LIMITS: LIMITS,
    cleanName: cleanName,
    cleanPet: cleanPet,
    cleanRoomId: cleanRoomId,
    isPublicRoom: isPublicRoom,
    roomLabel: roomLabel,
    wishesFor: wishesFor,
    validWish: validWish,
    hasBatchim: hasBatchim,
    callName: callName,
    species: function (id) { return findById(SPECIES, id) || SPECIES[0]; },
    color: function (id) { return findById(COLORS, id) || COLORS[1]; }
  };
}));
