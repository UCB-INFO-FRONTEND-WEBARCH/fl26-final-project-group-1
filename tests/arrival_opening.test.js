import test from 'node:test';
import assert from 'node:assert/strict';
import { ArrivalOpening, ARRIVAL_BLANK_SECONDS, ARRIVAL_REVEAL_SECONDS } from '../src/arrival_opening.js';

test('a ready overview cannot reveal the map while the landing UI is still leaving', () => {
  const opening = new ArrivalOpening();
  opening.overview_ready = true;
  opening.update(30);
  assert.equal(opening.phase, 'waiting');
  assert.equal(opening.elapsed, 0);
  assert.equal(opening.opacity, 0);
  opening.entry_complete = true;
  opening.update(1 / 60);
  opening.update(ARRIVAL_BLANK_SECONDS - 0.01);
  assert.equal(opening.phase, 'blank');
  assert.equal(opening.opacity, 0);
});

test('only the initial overview gates the reveal', () => {
  const opening = new ArrivalOpening();
  opening.entry_complete = true;
  opening.update(1 / 60);
  opening.update(30);
  assert.equal(opening.phase, 'blank');
  assert.equal(opening.opacity, 0);
  opening.overview_ready = true;
  opening.update(1 / 60);
  assert.equal(opening.phase, 'revealing');
  assert.equal(opening.opacity, 0);
  opening.update(ARRIVAL_REVEAL_SECONDS / 2);
  assert.equal(opening.opacity, 0.5);
  assert.equal(opening.phase, 'revealing');
  opening.update(ARRIVAL_REVEAL_SECONDS / 2);
  assert.equal(opening.opacity, 1);
  assert.equal(opening.phase, 'complete');
});
