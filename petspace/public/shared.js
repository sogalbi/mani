/* 브라우저와 서버가 함께 쓰는 값과 검사 함수. 의존성 없이 유지해요. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PS = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BRAND = '꼬리별 추모관';
  var BRAND_SHORT = '꼬리별';

  var SPECIES = [
    { id: 'dog', label: '강아지' },
    { id: 'cat', label: '고양이' },
    { id: 'rabbit', label: '토끼' },
    { id: 'hamster', label: '햄스터' },
    { id: 'bird', label: '새' }
  ];

  var COLORS = [
    { id: 'white', label: '하양', fill: '#f6f2ea', shade: '#d9cfc1', line: '#8f8476' },
    { id: 'cream', label: '크림', fill: '#efd6a8', shade: '#d2b07a', line: '#8a6c42' },
    { id: 'cheese', label: '치즈', fill: '#eba45d', shade: '#c97f3c', line: '#7d4a1d' },
    { id: 'brown', label: '갈색', fill: '#9d6c47', shade: '#77502f', line: '#43291a' },
    { id: 'gray', label: '회색', fill: '#a9adb3', shade: '#82878e', line: '#4a4e55' },
    { id: 'black', label: '검정', fill: '#46413e', shade: '#2d2927', line: '#141211' }
  ];

  // 화면에 띄우는 한마디 (사진 올릴 때 고르는 것). 이름을 앞에 붙여 "초코야, 보고 싶어"처럼 보여요.
  var MESSAGES = ['보고 싶어', '고마웠어', '사랑해', '별에서 편히 쉬어', '다시 만나자', '우리 집에 와줘서 고마워', '이제 아프지 마'];

  // 홀에서 말 대신 띄우는 말풍선. 자유 대화는 없어요.
  var WORDS = ['보고 싶어', '고마웠어', '사랑해', '편히 쉬어', '힘내세요', '같이 기억할게요', '♥'];

  var LIMITS = {
    nameMax: 10,
    messageMax: 40,
    photoMaxBytes: 450 * 1024,
    photoMaxSide: 900,
    sayCooldownMs: 1500,
    flowerCooldownMs: 2500,
    spotCooldownMs: 60000,
    spotMs: 12000,
    slideMs: 8000
  };

  var BLOCKED = [
    '씨발', '시발', '씨빨', '씨바', 'ㅅㅂ', 'ㅆㅂ', '병신', '븅신', 'ㅂㅅ', '좆', '존나', '졸라',
    '개새', '새끼', 'ㅅㄲ', '섹스', '니미', '느금', '니애미', '엠창', '지랄', 'ㅈㄹ', '염병',
    '닥쳐', '꺼져', '자살', '뒤져', '일베', '메갈', '한남', '김치녀', '틀딱',
    'fuck', 'shit', 'bitch', 'sex', 'porn', 'nigg', 'cunt'
  ];
  var LINKY = /(https?|www\.|\.com|\.net|\.kr|\.io|kakao|카톡|오픈톡|오픈채팅|텔레그램|telegram|토토|카지노|대출)/i;
  var NAME_CHARS = /^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ .\-_~♥♡]+$/;
  var MESSAGE_CHARS = /^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ .,!?~♥♡'"()\-_…·]+$/;

  function range(a, b) { return String.fromCharCode(a) + '-' + String.fromCharCode(b); }
  // 제어 문자, 폭 없는 문자, 방향 바꾸는 문자를 지워요.
  var INVISIBLE = new RegExp('[' + range(0, 31) + range(127, 159) + range(0xad, 0xad) + range(0x200b, 0x200f) +
    range(0x2028, 0x202e) + range(0x2060, 0x206f) + range(0xfeff, 0xfeff) + ']', 'g');

  function tidy(raw, max) {
    var s = raw.normalize ? raw.normalize('NFC') : raw;
    s = s.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
    return Array.from(s).slice(0, max).join('').trim();
  }

  function isBlocked(s) {
    if (LINKY.test(s)) return true;
    if ((s.match(/[0-9]/g) || []).length >= 4) return true;
    var compact = s.toLowerCase().replace(/[\s.,!?~♥♡'"()\-_…·0-9]/g, '');
    for (var i = 0; i < BLOCKED.length; i++) if (compact.indexOf(BLOCKED[i]) !== -1) return true;
    return false;
  }

  function cleanName(raw) {
    if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
    var s = tidy(raw, LIMITS.nameMax);
    if (!s) return { ok: false, reason: 'empty' };
    if (!NAME_CHARS.test(s)) return { ok: false, reason: 'chars' };
    if (isBlocked(s)) return { ok: false, reason: 'blocked' };
    return { ok: true, name: s };
  }

  function cleanMessage(raw) {
    if (raw == null || raw === '') return { ok: true, text: '' };
    if (typeof raw !== 'string') return { ok: false, reason: 'chars' };
    var s = tidy(raw, LIMITS.messageMax);
    if (!s) return { ok: true, text: '' };
    if (!MESSAGE_CHARS.test(s)) return { ok: false, reason: 'chars' };
    if (isBlocked(s)) return { ok: false, reason: 'blocked' };
    return { ok: true, text: s };
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
        color: findById(COLORS, p.color) ? p.color : 'cream'
      }
    };
  }

  function cleanYear(v, now) {
    var y = typeof v === 'number' ? v : parseInt(v, 10);
    var max = new Date(now || Date.now()).getFullYear();
    return Number.isInteger(y) && y >= 1980 && y <= max ? y : null;
  }

  function cleanPos(x, y) {
    if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) return null;
    var r = function (v) { return Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000; };
    return { x: r(x), y: r(y) };
  }

  var PUBLIC_ROOM = /^hall-([1-9][0-9]{0,3})$/;
  var ROOM_ID = /^[a-z0-9][a-z0-9-]{0,23}$/;
  var PHOTO_ID = /^[a-f0-9]{16}$/;

  function cleanRoomId(r) {
    if (typeof r !== 'string') return null;
    r = r.trim().toLowerCase();
    return ROOM_ID.test(r) ? r : null;
  }
  function isPublicRoom(id) { return PUBLIC_ROOM.test(id || ''); }
  function roomLabel(id) {
    var m = PUBLIC_ROOM.exec(id || '');
    return m ? m[1] + '호실' : '가족 추모실';
  }

  // 받침이 있으면 부를 때 '아', 없으면 '야' (몽실아, 초코야)
  function hasBatchim(word) {
    var c = (word || '').charCodeAt(word.length - 1);
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 !== 0;
    return false;
  }
  function vocative(name) {
    if (!name) return '';
    var c = name.charCodeAt(name.length - 1);
    if (!(c >= 0xac00 && c <= 0xd7a3)) return name + ',';
    return name + (hasBatchim(name) ? '아,' : '야,');
  }
  function callName(name) { return hasBatchim(name) ? name + '이' : name; }

  return {
    BRAND: BRAND,
    BRAND_SHORT: BRAND_SHORT,
    SPECIES: SPECIES,
    COLORS: COLORS,
    MESSAGES: MESSAGES,
    WORDS: WORDS,
    LIMITS: LIMITS,
    PHOTO_ID: PHOTO_ID,
    cleanName: cleanName,
    cleanMessage: cleanMessage,
    cleanPet: cleanPet,
    cleanYear: cleanYear,
    cleanPos: cleanPos,
    cleanRoomId: cleanRoomId,
    isPublicRoom: isPublicRoom,
    roomLabel: roomLabel,
    hasBatchim: hasBatchim,
    vocative: vocative,
    callName: callName,
    species: function (id) { return findById(SPECIES, id) || SPECIES[0]; },
    color: function (id) { return findById(COLORS, id) || COLORS[1]; }
  };
}));
