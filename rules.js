export const RULES = Object.freeze({ duration: 60, startingLives: 2, maxLives: 2, shrinkEvery: 10, healEvery: 20, outsideLimit: 2, initialRadius: 18, shrinkBy: 2.4, playerSpeed: 6.3, enemySpeed: 2.1, speedPerShrink: .35, attackDuration: .48, attackCooldown: .9, attackRange: 3.3, hitDuration: .32, powerCharge: 15, powerTransform: 6, powerDuration: 10, powerMultiplier: 1.5 });

export function newRound() {
  return { time: 0, lives: RULES.startingLives, hits: 0, radius: RULES.initialRadius, stage: 0, outside: 0, healTick: 0, kills: 0, powerUsed: false, powerRemaining: 0, status: 'playing' };
}

export function activatePower(state) {
  if(state.status!=='playing'||state.powerUsed||state.time+1e-8<RULES.powerCharge)return false;
  state.powerUsed=true;state.status='powerup';return true;
}

export function finishPowerTransformation(state) { state.powerRemaining=RULES.powerDuration;state.status='playing'; }
export function playerAttackRange(state) { return RULES.attackRange*(state.powerRemaining>0?RULES.powerMultiplier:1); }

export function zoneRadius(angle, radius) {
  return radius * (1 + .085 * Math.sin(angle * 3 + .6) + .055 * Math.cos(angle * 5 - .8) + .04 * Math.sin(angle + 1.4));
}

export function isOutsideZone(position, radius) {
  return Math.hypot(position.x, position.z) > zoneRadius(Math.atan2(position.x, position.z), radius);
}

export function registerEnemyHit(state) {
  if (state.status !== 'playing') return;
  state.hits++;
  if (state.hits >= 3) { state.hits = 0; state.lives = Math.max(0, state.lives - 1); }
  if (!state.lives) state.status = 'lost';
}

export function advanceRound(state, dt, outside) {
  if (state.status !== 'playing') return { shrunk: false, healing: false, damaged: false };
  state.powerRemaining=Math.max(0,state.powerRemaining-dt);
  const previousStage = state.stage;
  state.time = Math.min(RULES.duration, state.time + dt);
  state.stage = Math.min(5, Math.floor((state.time + 1e-8) / RULES.shrinkEvery));
  state.radius = RULES.initialRadius - state.stage * RULES.shrinkBy;
  let damaged = false;
  // The caller tests the current zone before advancing; it retests after a shrink.
  state.outside = outside ? state.outside + dt : 0;
  if (state.outside + 1e-8 >= RULES.outsideLimit) {
    state.lives = Math.max(0, state.lives - 1);
    state.hits = 0;
    state.outside = 0;
    damaged = true;
  }
  const healTick = Math.floor((state.time + 1e-8) / RULES.healEvery);
  const healing = healTick > state.healTick && state.time < RULES.duration;
  state.healTick = healTick;
  if (state.lives <= 0) state.status = 'lost';
  else if (state.time >= RULES.duration) state.status = 'won';
  return { shrunk: state.stage > previousStage, healing, damaged };
}
