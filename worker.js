// worker.js — バックグラウンド計算スレッド
// UIスレッドと分離してフリーズを防ぐ

importScripts('typechart.js', 'data.js');

function scorePair(p1, p2) {
  let bothSuper = [], neutrals = [], covers = [];
  for (const atk of ALL_TYPES) {
    const e1 = getEffectiveness(atk, p1.types, p1.immune_types, p1.resist_types || []);
    const e2 = getEffectiveness(atk, p2.types, p2.immune_types, p2.resist_types || []);
    if (e1 > 1 && e2 > 1) {
      bothSuper.push(atk);
    } else if (e1 > 1 && e2 === 1) {
      neutrals.push({ atk, victim: p1.name });
    } else if (e2 > 1 && e1 === 1) {
      neutrals.push({ atk, victim: p2.name });
    } else if ((e1 > 1 && e2 < 1) || (e2 > 1 && e1 < 1)) {
      covers.push(atk);
    }
  }
  return { bothSuper, neutrals, covers };
}

function scoreTrio(p1, p2, p3) {
  let fail = [], neutrals = [], covers = [];
  const members = [p1, p2, p3];
  for (const atk of ALL_TYPES) {
    const e = members.map(p => getEffectiveness(atk, p.types, p.immune_types, p.resist_types || []));
    const nSuper   = e.filter(x => x > 1).length;
    const nNeutral = e.filter(x => x === 1).length;
    if (nSuper >= 2) {
      fail.push(atk);
    } else if (nSuper === 1 && nNeutral >= 1) {
      const idx = e.findIndex(x => x > 1);
      neutrals.push({ atk, victim: members[idx].name });
    } else if (nSuper === 1) {
      covers.push(atk);
    } else if (e.every(x => x < 1)) {
      covers.push(atk);
    }
  }
  return { fail, neutrals, covers };
}

self.onmessage = function(e) {
  const { mode, pinnedRanks, requiredCoverTypes = [], excludedRanks = [], disabledAbilityRanks = [], disabledResistRanks = [] } = e.data;
  // pinnedRanks: 固定ポケモンのrank配列 (0〜2個)

  const pool = POKEMON_LIST
    .filter(p => !excludedRanks.includes(p.rank))
    .map(p => {
      let out = { ...p };
      if (disabledAbilityRanks.includes(p.rank)) out.immune_types = [];
      if (disabledResistRanks.includes(p.rank))  out.resist_types = [];
      return out;
    });

  const pinned = pinnedRanks.map(r => pool.find(p => p.rank === r)).filter(Boolean);

  const results = [];

  if (mode === 'pair') {
    // 2匹モード
    if (pinned.length === 1) {
      // 1匹固定 → 相方を全探索
      const p1 = pinned[0];
      for (const p2 of pool) {
        if (p2.rank === p1.rank) continue;
        const { bothSuper, neutrals, covers } = scorePair(p1, p2);
        if (bothSuper.length === 0) {
          results.push({
            members: [p1, p2],
            neutralCount: neutrals.length,
            coverCount: covers.length,
            neutrals, covers,
          });
        }
      }
    } else {
      // 固定なし → 全ペア
      for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          const { bothSuper, neutrals, covers } = scorePair(pool[i], pool[j]);
          if (bothSuper.length === 0) {
            results.push({
              members: [pool[i], pool[j]],
              neutralCount: neutrals.length,
              coverCount: covers.length,
              neutrals, covers,
            });
          }
        }
      }
    }
  } else {
    // 3匹モード
    if (pinned.length === 2) {
      // 2匹固定 → 3匹目を探索
      const [p1, p2] = pinned;
      for (const p3 of pool) {
        if (p3.rank === p1.rank || p3.rank === p2.rank) continue;
        const { fail, neutrals, covers } = scoreTrio(p1, p2, p3);
        if (fail.length === 0) {
          results.push({
            members: [p1, p2, p3],
            neutralCount: neutrals.length,
            coverCount: covers.length,
            neutrals, covers,
          });
        }
        // 進捗を間引いて送る
        if (pool.indexOf(p3) % 50 === 0) {
          self.postMessage({ type: 'progress', done: pool.indexOf(p3), total: pool.length });
        }
      }
    } else if (pinned.length === 1) {
      // 1匹固定 → 残り2匹を全探索
      const p1 = pinned[0];
      const rest = pool.filter(p => p.rank !== p1.rank);
      const total = rest.length * (rest.length - 1) / 2;
      let done = 0;
      for (let i = 0; i < rest.length; i++) {
        for (let j = i + 1; j < rest.length; j++) {
          const { fail, neutrals, covers } = scoreTrio(p1, rest[i], rest[j]);
          if (fail.length === 0) {
            results.push({
              members: [p1, rest[i], rest[j]],
              neutralCount: neutrals.length,
              coverCount: covers.length,
              neutrals, covers,
            });
          }
          done++;
          if (done % 5000 === 0) {
            self.postMessage({ type: 'progress', done, total });
          }
        }
      }
    } else {
      // 固定なし → C(N,3)全探索
      const total = pool.length * (pool.length - 1) * (pool.length - 2) / 6;
      let done = 0;
      for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          for (let k = j + 1; k < pool.length; k++) {
            const { fail, neutrals, covers } = scoreTrio(pool[i], pool[j], pool[k]);
            if (fail.length === 0) {
              results.push({
                members: [pool[i], pool[j], pool[k]],
                neutralCount: neutrals.length,
                coverCount: covers.length,
                neutrals, covers,
              });
            }
            done++;
            if (done % 20000 === 0) {
              self.postMessage({ type: 'progress', done, total });
            }
          }
        }
      }
    }
  }

  // ⑤ 指定タイプに対してパーティ全員が弱点でない組み合わせに絞る
  const filtered = requiredCoverTypes.length === 0 ? results : results.filter(r => {
    return requiredCoverTypes.every(reqType => {
      return r.members.some(p => {
        const e = getEffectiveness(reqType, p.types, p.immune_types, p.resist_types || []);
        return e === 0; // 無効
      }) || r.covers.includes(reqType) || (() => {
        // 少なくとも1匹が等倍以下（=弱点でない）かつ誰かが抵抗
        return r.members.some(p => getEffectiveness(reqType, p.types, p.immune_types, p.resist_types || []) < 1);
      })();
    });
  });

  // 等倍の穴が少ない順 → カバー数が多い順
  filtered.sort((a, b) => a.neutralCount - b.neutralCount || b.coverCount - a.coverCount);

  self.postMessage({ type: 'done', results: filtered });
};