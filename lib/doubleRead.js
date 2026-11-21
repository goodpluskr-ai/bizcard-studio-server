// 같은 명함을 AI가 두 번 따로 읽은 결과를 줄마다 비교합니다.
// 2026-11-21~22 시험: 같은 명함인데 읽을 때마다 '오영록/오영독/오영복', '무쏘의/무소의'처럼 흔들림 →
// 두 번 읽어 다르면 고객 확인 대상으로 표시하고, 다른 쪽 판독도 함께 보여 줌.
// (둘 다 같은 글자로 틀리면 못 잡음 — 마지막 안전장치는 여전히 고객 확인)

function norm(s) {
  return (s || "").normalize("NFC")
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[•ㆍ‧∙⋅・●]/g, "·")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, "");
}

// pat을 txt 안 어디엔가 맞춰 보기(txt 앞뒤는 자유). 가장 적은 편집 거리와 txt에서 맞춘 구간을 돌려줌
function fitInside(pat, txt) {
  const m = pat.length, n = txt.length;
  if (!m) return { d: 0, start: 0, end: 0 };
  let prev = new Array(n + 1).fill(0), prevS = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i], curS = [0];
    for (let j = 1; j <= n; j++) {
      const sub = prev[j - 1] + (pat[i - 1] === txt[j - 1] ? 0 : 1), del = prev[j] + 1, ins = cur[j - 1] + 1;
      if (sub <= del && sub <= ins) { cur[j] = sub; curS[j] = prevS[j - 1]; }
      else if (del <= ins) { cur[j] = del; curS[j] = prevS[j]; }
      else { cur[j] = ins; curS[j] = curS[j - 1]; }
    }
    prev = cur; prevS = curS;
  }
  // 같은 거리면 맞춘 길이가 원래 줄 길이와 가까운 쪽 (오영록 vs 오영독: '오영'보다 '오영독')
  let best = 0;
  for (let j = 1; j <= n; j++) {
    if (prev[j] < prev[best] || (prev[j] === prev[best] && Math.abs(j - prevS[j] - m) < Math.abs(best - prevS[best] - m))) best = j;
  }
  return { d: prev[best], start: prevS[best], end: best };
}

// 글자 단위 차이 목록 (예: "소→쏘")
function diffChars(a, b) {
  const m = a.length, n = b.length;
  const D = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const out = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      if (a[i - 1] !== b[j - 1]) out.push(`${a[i - 1]}→${b[j - 1]}`);
      i--; j--;
    } else if (j > 0 && D[i][j] === D[i][j - 1] + 1) { out.push(`+${b[j - 1]}`); j--; }
    else { out.push(`-${a[i - 1]}`); i--; }
  }
  return out.reverse();
}

// 한 글자씩 끊어 읽은 이웃 줄(예: 이름 '오' '영' '록')을 한 줄로 이음 — 비교·고객 확인 모두 한 줄이 편함
function mergeSingleChars(lines) {
  const out = [];
  for (const l of lines) {
    const p = out[out.length - 1];
    if (p && p.type === l.type && norm(l.text).length === 1 && p._single) {
      out[out.length - 1] = { ...p, text: p.text + " " + l.text, unsure: p.unsure || l.unsure, unsure_chars: (p.unsure_chars || "") + (l.unsure_chars || "") };
    } else out.push({ ...l, _single: norm(l.text).length === 1 });
  }
  return out.map(({ _single, ...l }) => l);
}

// linesA(보여 줄 판독)의 각 줄에 secondRead 결과를 붙임
function compareReads(linesA, linesB) {
  const B = mergeSingleChars(linesB).map((l) => ({ raw: l.text || "", n: norm(l.text) })).filter((b) => b.n);
  // 다른 판독에서 줄을 붙여 읽은 경우도 맞출 수 있게, 이웃한 두 줄을 이은 것도 후보로
  const cands = [...B, ...B.slice(1).map((b, i) => ({ raw: B[i].raw + " " + b.raw, n: B[i].n + b.n }))];
  return linesA.map((l) => {
    const a = norm(l.text);
    if (!a || l.type === "unreadable") return { ...l, secondRead: { status: "skip" } };
    let best = null;
    for (const c of cands) {
      const f = fitInside(a, c.n);
      if (!best || f.d < best.d || (f.d === best.d && c.n.length < best.c.n.length)) best = { ...f, c };
    }
    if (best && best.d === 0) return { ...l, secondRead: { status: "same" } };
    const limit = Math.max(1, Math.floor(a.length * 0.4));
    if (!best || best.d > limit) return { ...l, secondRead: { status: "missing" } };
    // 다른 판독 줄 전체와 맞았으면 원래 띄어쓰기 그대로, 일부와 맞았으면 그 부분만(띄어쓰기 없이)
    const alt = best.start === 0 && best.end === best.c.n.length ? best.c.raw : best.c.n.slice(best.start, best.end);
    return { ...l, secondRead: { status: "diff", alt, diffs: diffChars(a, norm(alt)).slice(0, 6) } };
  });
}

module.exports = { compareReads, mergeSingleChars, norm, fitInside, diffChars };
