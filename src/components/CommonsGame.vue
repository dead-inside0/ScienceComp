<script setup lang="ts">
import { t, fish, tiles, points } from '../i18n'
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { teamState, acceptState, refreshState, session } from '../state'
import { competition, serverTime } from '../competition'
import { api, errorMessage } from '../api'
import { along, detour, partway } from '../motion'
import { coastPath, hash } from '../coast'
import type { BoatOrder, GameOrder, GameState, TeamState, Tile } from '../../shared/domain'
import TeamScores from './TeamScores.vue'
type School = GameState['schools'][number]
const error = ref(''), busy = ref(false)
const game = computed(() => teamState.value!.game)
const rules = computed(() => game.value.rules)
const map = computed(() => game.value.map!)
const myId = computed(() => teamState.value!.team.id)
const me = computed(() => game.value.boats.find(b => b.team === myId.value))
const research = computed(() => teamState.value!.team.research)
const same = (a: Tile, b: Tile) => a.x === b.x && a.y === b.y
const sentTo = (order: BoatOrder | null) => order && 'school' in order ? order.school : null
const goal = computed(() => game.value.schools.find(s => s.id === sentTo(me.value?.target ?? null)))
const here = computed(() => me.value && game.value.schools.find(s => same(s, me.value!)))
const stuck = computed(() => !!me.value?.route.length && research.value < rules.value.fuelCost)
const baitPaused = computed(() => game.value.own.bait && research.value < rules.value.baitCost + rules.value.baitReserve)
const boost = computed(() => Math.round((rules.value.baitBoost - 1) * 100))
const status = computed(() => {
  const boat = me.value, r = rules.value, ground = here.value
  if (!boat) return ''
  const left = { tiles: tiles(boat.route.length) }
  if (stuck.value) return t('Out of Research! Answer questions to refuel.')
  if (boat.route.length && game.value.own.hold >= r.hold) return t('Hold full: sailing home to unload ({tiles} to go)', left)
  if (boat.route.length) return t(goal.value ? 'Sailing to a fishing ground: {tiles} to go' : 'Sailing: {tiles} to go', left)
  if (ground?.fish) return t('Fishing: next fish in about {seconds} s', { seconds: Math.ceil((r.catchEffort - boat.hauling) / (ground.fish * (game.value.own.bait && !baitPaused.value ? r.baitBoost : 1))) * r.tickSeconds })
  if (ground) return t('Fishing, but this ground is empty and regrows slowly.')
  return t('Idle. Tap a fishing ground on the map to send your boat.')
})
// Fishing grounds, nearest first.
const maxOf = (s: School) => s.golden ? rules.value.goldenMax : rules.value.schoolMax
const health = (s: School) => s.fish * 2 >= maxOf(s) ? 'healthy' : s.fish * 5 <= maxOf(s) ? 'overfished' : 'low'
const visitors = (s: School) => game.value.boats.filter(b => sentTo(b.target) === s.id || (!b.route.length && same(b, s)))
const radar = computed(() => [...game.value.schools].sort((a, b) => a.sail - b.sail))
const label = (s: School) => s.golden
  ? `${t('Golden ground {count}/{max}', { count: s.fish, max: maxOf(s) })} · ${t('{points} a fish', { points: points(rules.value.goldenValue) })}`
  : `${t('Ground {count}/{max}', { count: s.fish, max: maxOf(s) })} · ${t(health(s))}`
const spots = [[-0.2, -0.16, 0], [0.2, -0.1, 180], [-0.02, 0.24, 0]] as const
const shown = (s: School) => s.fish ? spots.slice(0, { healthy: 3, low: 2, overfished: 1 }[health(s)]) : []

// "+1" rises from your boat when a catch comes in.
const pops = ref<{ id: number; text: string; golden: boolean }[]>([])
let popId = 0
watch(() => [game.value.own.fish, game.value.own.bonus] as const, ([f, b], [pf, pb]) => {
  if (f + b <= pf + pb) return
  const id = ++popId
  pops.value.push({ id, text: `+${f + b - pf - pb}`, golden: b > pb })
  setTimeout(() => { pops.value = pops.value.filter(p => p.id !== id) }, 1400)
})

// One destination at a time; one given meanwhile waits, and only the latest is sent.
let waiting: BoatOrder | null = null
const sending = ref<BoatOrder | null>(null), baiting = ref<boolean | null>(null)
// A response or failure that arrives once the session has changed belongs to the old session and is dropped.
async function request(order: GameOrder) {
  const from = session.value
  try { const value = await api<TeamState>('/team/game/order', order); if (from === session.value) acceptState(value) }
  catch (e) { if (from === session.value) { error.value = errorMessage(e); await refreshState() } }
}
async function send(order: BoatOrder) {
  error.value = ''; sending.value = order
  if (busy.value) { waiting = order; return }
  busy.value = true
  try {
    for (let next: BoatOrder | null = order; next; next = waiting) { waiting = null; sending.value = next; await request(next) }
  } finally { busy.value = false; sending.value = null }
}
// The bait switch skips the destination queue, so a tap on the map cannot drop it.
async function setBait(on: boolean) {
  error.value = ''; baiting.value = on
  try { await request({ bait: on }) } finally { baiting.value = null }
}
// Waiting orders belong to the session that gave them.
watch(session, () => { waiting = null }, { flush: 'sync' })

// Phones turn the map a quarter, so it fills a tall screen.
const narrow = matchMedia('(max-width: 700px)'), portrait = ref(narrow.matches)
const turn = (e: MediaQueryListEvent) => { portrait.value = e.matches }
narrow.addEventListener('change', turn)
onUnmounted(() => narrow.removeEventListener('change', turn))
const H = computed(() => map.value.height)
const view = (x: number, y: number): [number, number] => portrait.value ? [H.value - y, x] : [x, y]
const box = computed(() => portrait.value ? [map.value.height, map.value.width] : [map.value.width, map.value.height])
const place = (p: Tile) => `translate(${view(p.x + 0.5, p.y + 0.5).join(' ')})`
// A tap near a fishing ground sends the boat there; elsewhere on open sea, to that tile.
function tap(event: MouseEvent) {
  const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect()
  const vx = (event.clientX - rect.left) / rect.width * box.value[0], vy = (event.clientY - rect.top) / rect.height * box.value[1]
  const [fx, fy] = portrait.value ? [vy, H.value - vx] : [vx, vy]
  const near = game.value.schools.map(s => ({ s, d: Math.hypot(s.x + 0.5 - fx, s.y + 0.5 - fy) })).sort((a, b) => a.d - b.d)[0]
  if (near && near.d < 0.8) return send({ school: near.s.id })
  const x = Math.floor(fx), y = Math.floor(fy)
  if (map.value.land[y]?.[x] === '.') return send({ x, y })
}
// A tile order keeps a flag at its target, faded while it is still being sent.
const flag = computed(() => {
  const order = sending.value ?? me.value?.target ?? null
  return order && !('school' in order) ? { ...order, faded: !!sending.value } : null
})

// Terrain, redrawn only when the map or its orientation changes.
const grid = computed(() => map.value.land.join('\n'))
const coast = computed(() => coastPath(grid.value.split('\n'), view))
const cells = computed(() => grid.value.split('\n').flatMap((row, y) => [...row].map((c, x) => ({ x, y, sea: c === '.' }))))
const wavelets = computed(() => cells.value.filter(c => c.sea && hash(c.x, c.y, 1) < 0.33).map(({ x, y }) => {
  const [cx, cy] = view(x + 0.3 + hash(x, y, 2) * 0.4, y + 0.3 + hash(x, y, 3) * 0.4)
  return `M${(cx - 0.14).toFixed(3)} ${cy.toFixed(3)}q.07 -.06 .14 0t.14 0`
}).join(''))
const trees = computed(() => cells.value.filter(c => !c.sea && hash(c.x, c.y, 4) < 0.44).map(({ x, y }) => view(x + 0.5 + (hash(x, y, 5) - 0.5) * 0.3, y + 0.5 + (hash(x, y, 6) - 0.5) * 0.2).map(v => +v.toFixed(3))))
const canopies = computed(() => trees.value.map(([x, y]) => `M${x - 0.17} ${y}a.17 .17 0 1 0 .34 0a.17 .17 0 1 0 -.34 0`).join(''))
const trunks = computed(() => trees.value.map(([x, y]) => `M${x} ${y + 0.08}v.16`).join(''))

// Boats face where they sail next; your boat is drawn last. Boats sharing a tile spread out in a small spiral.
const facing = new Map<string, number>()
const fleet = computed(() => {
  const boats = [...game.value.boats].sort((a, b) => Number(a.team === myId.value) - Number(b.team === myId.value))
  return boats.map((b, i) => {
    const next = b.ahead[0], dx = next ? view(next.x, next.y)[0] - view(b.x, b.y)[0] : 0
    if (dx) facing.set(b.team, Math.sign(dx))
    const crowd = boats.filter(o => same(o, b)), n = crowd.length, k = crowd.indexOf(b), r = 0.22 * Math.sqrt((k + 0.5) / n), own = b.team === myId.value
    const [ox, oy] = n > 1 ? [r * Math.cos(2.4 * k), r * Math.sin(2.4 * k) * 0.65] : [0, 0], scale = (n > 6 ? 0.6 : n > 2 ? 0.8 : 1) * (own ? 1.1 : 1)
    return { ...b, own, face: facing.get(b.team) ?? 1, moving: !!next && !same(next, b), nudge: { color: b.color, transform: `translate(${ox.toFixed(3)}px, ${oy.toFixed(3)}px) scale(${scale})` }, delay: `${(-i * 0.83 % 2.6).toFixed(2)}s` }
  })
})

// The frame loop is the only writer of boat positions: each boat follows the server's
// lookahead in step with the server clock, and a changed course is joined by a short detour along sea tiles.
const sea = ref<SVGSVGElement>()
const FIX_MS = 400, reduce = matchMedia('(prefers-reduced-motion: reduce)')
const drawn = new Map<string, { path: Tile[]; tick: number; at: Tile; fix?: { via: Tile[]; from: number }; jump?: boolean }>()
const paths = computed(() => new Map(game.value.boats.map(b => [b.team, [{ x: b.x, y: b.y }, ...b.ahead]])))
const routes = computed(() => new Map(game.value.boats.map(b => [b.team, b.route])))
let frame = 0
function draw(now: number) {
  frame = requestAnimationFrame(draw)
  const svg = sea.value, startedAt = competition.value?.startedAt
  if (!svg || startedAt == null) return
  const T = rules.value.tickSeconds * 1000, N = game.value.clock.tick, tau = (serverTime() - startedAt) / T
  for (const [team, path] of paths.value) {
    let d = drawn.get(team)
    // A response that overtook a newer one carries an older tick; it is skipped rather than drawn backwards.
    if (!d || (d.path !== path && !d.fix && N >= d.tick)) {
      const R = along(path, tau - N)
      if (d && Math.hypot(d.at.x - R.x, d.at.y - R.y) > 0.05) {
        const via = reduce.matches ? null : detour(d.path, tau - d.tick, path, tau + FIX_MS / T - N, N - d.tick)
        d = { path, tick: N, at: R, fix: via ? { via, from: now } : undefined, jump: !reduce.matches && !via }
      } else d = { path, tick: N, at: R }
      drawn.set(team, d)
    }
    const k = d.fix ? (now - d.fix.from) / FIX_MS : 1
    if (k >= 1) d.fix = undefined
    d.at = d.fix ? partway(d.fix.via, k * k * (3 - 2 * k)) : along(d.path, reduce.matches ? Math.floor(tau - d.tick) : tau - d.tick)
  }
  svg.querySelectorAll<SVGGElement>('[data-sprite]').forEach(el => {
    const d = drawn.get(el.dataset.sprite!)
    if (!d) return
    const [x, y] = view(d.at.x + 0.5, d.at.y + 0.5)
    el.style.transform = `translate(${x}px, ${y}px)`
    if (d.jump) { el.animate([{ opacity: 0 }, { opacity: 1 }], 250); d.jump = false }
  })
  // Each route starts at the drawn boat, without the tiles it has already sailed.
  svg.querySelectorAll<SVGPolylineElement>('[data-route]').forEach(el => {
    const team = el.dataset.route!, d = drawn.get(team), route = routes.value.get(team)
    if (!d || !route) return
    let moved = 0
    for (let i = 1; i <= Math.min(Math.floor(tau - d.tick), d.path.length - 1); i++) if (!same(d.path[i]!, d.path[i - 1]!)) moved++
    el.setAttribute('points', [d.at, ...route.slice(moved)].map(p => view(p.x + 0.5, p.y + 0.5).map(v => v.toFixed(3)).join(',')).join(' '))
  })
}
const start = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw) }
const stop = () => cancelAnimationFrame(frame)
onMounted(start); onActivated(start); onDeactivated(stop); onUnmounted(stop)
</script>
<template>
  <main class="commons">
    <h1 class="sr-only">{{ t('Game') }}</h1>
    <div class="hud">
      <div class="hud-card hud-score"><span class="hud-label">{{ t('Score') }}</span><strong aria-live="polite">{{ game.own.fish + game.own.bonus }}</strong><span class="hud-sub">{{ t('{fish} + {bonus} golden', { fish: fish(game.own.fish), bonus: game.own.bonus }) }}</span></div>
      <div class="hud-card hud-fuel" :class="{ empty: research < rules.fuelCost }"><span class="hud-label">{{ t('Fuel') }}</span><strong>{{ Math.floor(research) }}</strong><span class="hud-sub">{{ t('Research; {cost} per tile', { cost: rules.fuelCost }) }}</span></div>
      <div class="hud-card hud-hold" :class="{ full: game.own.hold >= rules.hold }"><span class="hud-label">{{ t('Hold') }}</span><strong>{{ game.own.hold }}/{{ rules.hold }}</strong></div>
      <div class="hud-card hud-bait" :class="{ on: game.own.bait, paused: baitPaused }">
        <span class="hud-row">
          <label class="hud-label" for="commons-bait">{{ t('Bait') }}</label>
          <input id="commons-bait" class="switch" type="checkbox" role="switch" aria-describedby="commons-bait-note" :checked="baiting ?? game.own.bait" :disabled="baiting !== null" @change="setBait(($event.target as HTMLInputElement).checked)">
        </span>
        <span id="commons-bait-note" class="hud-sub">{{ baitPaused ? t('Paused below {reserve} Research to keep fuel for sailing', { reserve: rules.baitReserve }) : t('Catch {boost}% faster; {cost} Research a fish', { boost, cost: rules.baitCost }) }}</span>
      </div>
      <div class="hud-card hud-status" :class="{ alert: stuck }" role="status">
        <span>{{ status }}<template v-if="sending">{{ ' ' }}<span class="sending">· {{ t('Sending…') }}</span></template></span>
        <RouterLink v-if="stuck" to="/play/questions" class="refuel">{{ t('Go to questions') }}</RouterLink>
      </div>
    </div>
    <p class="feedback error" role="status">{{ t(error) }}</p>
    <div class="commons-layout">
      <div class="sea-frame">
        <svg v-if="game.map" ref="sea" class="sea" :viewBox="`0 0 ${box[0]} ${box[1]}`" :style="{ aspectRatio: `${box[0]} / ${box[1]}`, '--ratio': box[0] / box[1] }" :aria-label="t('Map. Use the list of fishing grounds to send your boat.')" @click="tap">
          <defs>
            <path id="commons-coast" :d="coast" />
            <radialGradient id="commons-glow"><stop offset="0" stop-color="#fff6b0" stop-opacity=".95" /><stop offset=".55" stop-color="#ffd23f" stop-opacity=".55" /><stop offset="1" stop-color="#ffd23f" stop-opacity="0" /></radialGradient>
            <g id="commons-fish"><path d="M-0.15 0C-0.09 -0.09 0.05 -0.09 0.09 0C0.05 0.09 -0.09 0.09 -0.15 0ZM0.07 0L0.17 -0.075L0.17 0.075Z" /><circle class="fish-eye" cx="-0.085" cy="-0.015" r="0.017" /></g>
            <path id="commons-spark" d="M0 -0.08L0.02 -0.02L0.08 0L0.02 0.02L0 0.08L-0.02 0.02L-0.08 0L-0.02 -0.02Z" />
            <g id="commons-hull-shape"><path d="M-0.4 -0.02H0.4Q0.36 0.2 0.22 0.24H-0.24Q-0.36 0.2 -0.4 -0.02Z" /><path d="M0.04 -0.46Q0.36 -0.24 0.33 -0.06H0.04Z" /><path d="M-0.04 -0.36L-0.27 -0.06H-0.04Z" /></g>
            <g id="commons-boat"><path class="hull" d="M-0.4 -0.02H0.4Q0.36 0.2 0.22 0.24H-0.24Q-0.36 0.2 -0.4 -0.02Z" /><path class="mast" d="M0 -0.02V-0.48" /><path class="sail" d="M0.04 -0.46Q0.36 -0.24 0.33 -0.06H0.04Z" /><path class="sail" d="M-0.04 -0.36L-0.27 -0.06H-0.04Z" /><path class="pennant" d="M0 -0.48L0.16 -0.44L0 -0.4Z" /></g>
          </defs>
          <rect class="water" :width="box[0]" :height="box[1]" />
          <path class="wavelets" :d="wavelets" />
          <use v-for="layer in ['foam', 'shallows', 'grass', 'grass-rim', 'beach']" :key="layer" href="#commons-coast" class="coast" :class="layer" />
          <path class="trunks" :d="trunks" /><path class="canopies" :d="canopies" />
          <g class="harbour" :transform="place(map.harbour)">
            <path class="pier" d="M-0.72 0.26H0.46V0.46H-0.72Z" /><path class="planks" d="M-0.62 0.27V0.45M-0.46 0.27V0.45M-0.3 0.27V0.45M-0.14 0.27V0.45M0.02 0.27V0.45M0.18 0.27V0.45M0.34 0.27V0.45" />
            <circle class="post" cx="-0.2" cy="0.27" r="0.05" /><circle class="post" cx="0.4" cy="0.27" r="0.05" />
            <g transform="translate(-0.6 0.34)"><path class="tower" d="M-0.075 0L-0.05 -0.4H0.05L0.075 0Z" /><path class="stripe" d="M-0.066 -0.13H0.066M-0.058 -0.26H0.058" /><path class="cap" d="M-0.07 -0.4H0.07L0 -0.5Z" /><circle class="lamp" cy="-0.43" r="0.04" /></g>
          </g>
          <polyline v-for="b in game.boats.filter(b => b.route.length)" :key="`r${b.team}`" class="route" :class="{ own: b.team === myId }" :stroke="b.color" :data-route="b.team" />
          <g v-for="s in game.schools" :key="`g${s.id}`" class="ground" :class="[health(s), { golden: s.golden }]" :transform="place(s)">
            <circle v-if="s.golden" r="0.7" fill="url(#commons-glow)" /><circle v-else class="shoal" r="0.4" />
            <circle class="track" r="0.44" />
            <circle class="fill" r="0.44" pathLength="1" :stroke-dasharray="`${s.fish / maxOf(s)} 1`" transform="rotate(-90)" />
            <use v-for="([x, y, angle], i) in shown(s)" :key="i" href="#commons-fish" :transform="`translate(${x} ${y}) rotate(${angle})`" />
            <template v-if="s.golden"><use class="spark" href="#commons-spark" transform="translate(0.34 -0.34)" /><use class="spark" href="#commons-spark" transform="translate(-0.36 0.1) scale(0.7)" /></template>
            <circle v-if="s.id === goal?.id" class="aim" r="0.5" />
          </g>
          <g v-if="flag" class="flag" :class="{ faded: flag.faded }" :transform="place(flag)"><ellipse class="flag-foot" cy="0.25" rx="0.12" ry="0.05" /><path class="flag-pole" d="M0 0.25V-0.42" /><path class="flag-cloth" d="M0 -0.42L0.32 -0.31L0 -0.2Z" /></g>
          <g v-for="b in fleet" :key="`b${b.team}`" class="boat" :class="{ own: b.own }" :data-sprite="b.team">
            <g class="nudge" :style="b.nudge">
              <template v-if="b.own"><ellipse class="ring-ink" cy="0.2" rx="0.5" ry="0.22" /><ellipse class="ring" cy="0.2" rx="0.5" ry="0.22" /><ellipse v-if="b.hauling" class="haul" cy="0.2" rx="0.5" ry="0.22" pathLength="1" :stroke-dasharray="`${b.hauling / rules.catchEffort} 1`" /></template>
              <g class="bob" :style="{ animationDelay: b.delay }">
                <g :transform="b.face < 0 ? 'scale(-1 1)' : undefined"><path v-if="b.moving" class="wake" d="M-0.42 0.14l-0.2 -0.07M-0.42 0.22l-0.2 0.07" /><use class="sticker" href="#commons-hull-shape" /><use href="#commons-boat" /></g>
              </g>
            </g>
            <template v-if="b.own"><text v-for="p in pops" :key="p.id" class="pop" :class="{ golden: p.golden }" x="-0.2" y="-0.62">{{ p.text }}</text></template>
            <title>{{ b.name }}</title>
          </g>
          <!-- Counts go above the boats, which often sit on them. -->
          <g v-for="s in game.schools" :key="`n${s.id}`" class="count" :transform="`${place(s)} translate(0.34 0.34)`"><circle r="0.21" /><text dy="0.1">{{ s.fish }}</text></g>
        </svg>
      </div>
      <aside class="commons-side">
        <section class="radar" :aria-label="t('Fishing grounds')">
          <h2>{{ t('Fishing grounds') }}</h2>
          <ul>
            <li v-for="s in radar" :key="s.id">
              <button class="radar-item" :class="{ golden: s.golden, target: s.id === goal?.id }" :aria-pressed="s.id === goal?.id" @click="send({ school: s.id })">
                <span class="radar-name">{{ label(s) }}</span>
                <span class="radar-meta">
                  <span>{{ tiles(s.sail) }} · {{ t('round trip to unload: {n} Research', { n: 2 * s.home * rules.fuelCost }) }}</span>
                  <span v-for="b in visitors(s)" :key="b.team" class="radar-dot" :style="{ background: b.color }" :title="b.name" />
                  <span v-if="visitors(s).length > 1" class="crowded">{{ t('crowded') }}</span>
                </span>
              </button>
            </li>
          </ul>
        </section>
        <section class="leaderboard">
          <h2>{{ t('Leaderboard') }}</h2>
          <p v-if="teamState!.standings.frozenAt !== null" class="hint">{{ t('Frozen for the final 5 minutes.') }}</p>
          <TeamScores :teams="teamState!.standings.teams" :current-team-id="myId" label="Leaderboard" />
        </section>
        <details class="how-it-works">
          <summary>{{ t('How to play') }}</summary>
          <p>{{ t('Tap a fishing ground to send your boat. It sails one tile every {seconds} s by the shortest route, and every tile burns {cost} Research: answer questions to refuel. Everyone sees every boat.', { seconds: rules.tickSeconds, cost: rules.fuelCost }) }}</p>
          <p>{{ t('On a ground your boat fishes by itself, and the more fish the ground has, the faster it catches them. Grounds never move. Each regrows up to {fish} every {seconds} s (just one when nearly empty, none when full), so boats sharing a ground empty it fast and then all catch slowly.', { fish: fish(rules.growthCap, true), seconds: rules.growthTicks * rules.tickSeconds }) }}</p>
          <p>{{ t('Your boat holds {fish}. When it is full it sails home to the harbour by itself to unload, then goes back, burning Research both ways. Grounds far from the harbour cost more fuel per fish.', { fish: fish(rules.hold) }) }}</p>
          <p>{{ t('Golden grounds lie far out. Each golden fish is worth {points}, but a golden ground holds at most {max} and regrows only {growth} every {seconds} s.', { points: points(rules.goldenValue), max: fish(rules.goldenMax), growth: fish(rules.goldenCap, true), seconds: rules.growthTicks * rules.tickSeconds }) }}</p>
          <p>{{ t('Bait makes your boat catch {boost}% faster, but each fish caught with bait costs {cost} Research. Bait never takes you below {reserve} Research, which stays for sailing.', { boost, cost: rules.baitCost, reserve: rules.baitReserve }) }}</p>
          <p>{{ t('Score: fish caught plus golden points. Unused Research is worth nothing, and being first or fastest earns nothing: look in every few minutes and decide whether to stay or move.') }}</p>
        </details>
      </aside>
    </div>
  </main>
</template>
