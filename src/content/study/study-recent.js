import { STUDY } from '../../shared/constants.js';

// Pure helpers for the study picker. No DOM or chrome access.

const keyOf = (t) => t.eco + '|' + t.name;

// Newest first, deduped by eco|name, capped at `max`. Never mutates `recent`.
export function updateRecent(recent, target, max = STUDY.RECENT_MAX) {
  const list = Array.isArray(recent) ? recent : [];
  const key = keyOf(target);
  return [target, ...list.filter(t => t && keyOf(t) !== key)].slice(0, max);
}

// The side that plays the line's last move.
export function defaultStudyColor(sanMoves) {
  return (sanMoves || []).length % 2 === 1 ? 'w' : 'b';
}
