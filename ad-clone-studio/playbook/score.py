"""따라잡기 점수: 원본 구간과 생성 구간을 같은 쇼트 경계로 비교한다.

usage: score.py REF GEN REF_START "b0,b1,...,bn"(구간 내 쇼트 경계, 초) [--json out.json]
점수(100점): 컷 일치 25 + 타이밍 15 + 전환 방식 15 + 색 25 + 움직임 20
"""
import json, sys
from pathlib import Path
import cv2, numpy as np
from adclone.analysis.scene_detector import detect_cuts
from adclone.domain.models import DetectParams

ref_p, gen_p, ref_start = sys.argv[1], sys.argv[2], float(sys.argv[3])
B = [float(x) for x in sys.argv[4].split(",")]
out = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else None
TOL = 0.2

def frame(cap, t):
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000); ok, f = cap.read()
    return cv2.resize(f, (480, 270)) if ok else np.zeros((270, 480, 3), np.uint8)

def stats(cap, a, b):
    ts = np.linspace(a + 0.08, b - 0.08, 6); fs = [frame(cap, t) for t in ts]
    hsv = np.array([cv2.cvtColor(f, cv2.COLOR_BGR2HSV) for f in fs]).astype(float); bgr = np.array(fs).astype(float)
    flows = []
    for x, y in zip(fs, fs[1:]):
        fl = cv2.calcOpticalFlowFarneback(cv2.cvtColor(x, cv2.COLOR_BGR2GRAY), cv2.cvtColor(y, cv2.COLOR_BGR2GRAY), None, 0.5, 3, 21, 3, 5, 1.2, 0)
        flows.append(np.linalg.norm(fl, axis=2).mean() / max(ts[1] - ts[0], 1e-6))
    return dict(bright=hsv[..., 2].mean() / 255, sat=hsv[..., 1].mean() / 255,
                warm=(bgr[..., 2].mean() - bgr[..., 0].mean()) / 255, motion=float(np.mean(flows)))

dur = B[-1]
hard_cuts = [c / 1000 for c in detect_cuts(Path(gen_p), DetectParams(), int(dur * 1000)).cuts_ms if c / 1000 < dur - 0.05]

def blur_events(path, total, start=0.0):
    """휙 번지는 전환(휩/줌 블러): 선명도가 주변의 40% 아래로 떨어지는 순간."""
    cap = cv2.VideoCapture(path); fps = cap.get(cv2.CAP_PROP_FPS) or 30; sharp = []
    cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000)
    while len(sharp) / fps < total:
        ok, f = cap.read()
        if not ok: break
        sharp.append(cv2.Laplacian(cv2.cvtColor(cv2.resize(f, (320, 180)), cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())
    sharp = np.array(sharp); w = int(0.6 * fps); ev = []
    for i in range(len(sharp)):
        lo, hi = max(0, i - w), min(len(sharp), i + w + 1)
        if sharp[i] == sharp[lo:hi].min() and sharp[i] < 0.4 * np.median(sharp[lo:hi]): ev.append(i / fps)
    return ev

all_blur = blur_events(gen_p, dur)
ref_blur = blur_events(ref_p, dur, ref_start)
whips = [w for w in all_blur if all(abs(w - c) > 0.25 for c in hard_cuts)]
gen_cuts = sorted(hard_cuts + whips)
TOL = 0.25
expected = B[1:-1]; used = set(); errs = []; rows = []
for e in expected:
    cand = sorted((abs(c - e), c) for c in gen_cuts if c not in used)
    if cand and cand[0][0] <= TOL:
        used.add(cand[0][1]); errs.append(cand[0][1] - e); rows.append((e, cand[0][1]))
    else: rows.append((e, None))
extra = [c for c in hard_cuts if c not in used]  # 블러 전환은 쇼트 안에서도 쓰이므로 감점하지 않는다
matched = len(errs); mean_err = float(np.mean(np.abs(errs))) if errs else None
ref, gen = cv2.VideoCapture(ref_p), cv2.VideoCapture(gen_p)
shots = []
for a, b in zip(B, B[1:]):
    r, g = stats(ref, ref_start + a, ref_start + b), stats(gen, a, b)
    shots.append(dict(start=a, end=b, ref=r, gen=g))
w = np.array([s["end"] - s["start"] for s in shots]); w = w / w.sum()
def wavg(f): return float(sum(wi * f(s) for wi, s in zip(w, shots)))
d_bright = wavg(lambda s: abs(s["ref"]["bright"] - s["gen"]["bright"]))
d_sat = wavg(lambda s: abs(s["ref"]["sat"] - s["gen"]["sat"]))
d_warm = wavg(lambda s: abs(s["ref"]["warm"] - s["gen"]["warm"]))
motion_ratio = wavg(lambda s: min(s["ref"]["motion"], s["gen"]["motion"]) / max(s["ref"]["motion"], s["gen"]["motion"], 1e-6))
_u = set(); blur_hit = 0
for e in ref_blur:
    c = sorted((abs(x - e), x) for x in all_blur if x not in _u)
    if c and c[0][0] <= 0.3: _u.add(c[0][1]); blur_hit += 1
blur_f = (2 * blur_hit / (len(ref_blur) + len(all_blur))) if (ref_blur or all_blur) else 1.0
s_trans = 15 * blur_f
s_cut = 25 * max(0, matched - len(extra)) / max(1, len(expected))
s_time = 15 * (max(0, 1 - mean_err / TOL) if mean_err is not None else 0) * matched / max(1, len(expected))
s_color = 25 * max(0, 1 - (d_bright / 0.15 + d_sat / 0.15 + d_warm / 0.10) / 3)
s_motion = 20 * motion_ratio
total = s_cut + s_time + s_trans + s_color + s_motion
print("hard cuts", [round(c,2) for c in hard_cuts], "| blur transitions", [round(c,2) for c in whips])
print(f"cuts matched {matched}/{len(expected)}  extra {len(extra)}  mean |err| {mean_err if mean_err is None else round(mean_err,3)} s")
for e, c in rows: print(f"  {e:5.2f} -> " + (f"{c:5.2f} ({c-e:+.2f})" if c is not None else "MISSING"))
print(f"blur transitions: ref {[round(x,2) for x in ref_blur]} gen {[round(x,2) for x in all_blur]} matched {blur_hit}")
print(f"colour diff: bright {d_bright:.3f}  sat {d_sat:.3f}  warm {d_warm:.3f}   motion similarity {motion_ratio:.2f}")
print("shot   bright R/G    sat R/G     warm R/G      motion R/G")
for i, s in enumerate(shots, 1):
    r, g = s["ref"], s["gen"]
    print(f" {i:02d}   {r['bright']:.2f} {g['bright']:.2f}   {r['sat']:.2f} {g['sat']:.2f}   {r['warm']:+.2f} {g['warm']:+.2f}   {r['motion']:5.0f} {g['motion']:5.0f}")
print(f"SCORE {total:.1f} / 100  (cut {s_cut:.1f}/25, timing {s_time:.1f}/15, transition {s_trans:.1f}/15, colour {s_color:.1f}/25, motion {s_motion:.1f}/20)")
if out:
    Path(out).write_text(json.dumps(dict(total=round(total, 1), cut=round(s_cut, 1), timing=round(s_time, 1), transition=round(s_trans, 1), ref_blur=ref_blur, gen_blur=all_blur, colour=round(s_color, 1), motion=round(s_motion, 1),
        matched=matched, expected=len(expected), extra=len(extra), mean_abs_err=mean_err, d_bright=d_bright, d_sat=d_sat, d_warm=d_warm, motion_similarity=motion_ratio, shots=shots), indent=2))
