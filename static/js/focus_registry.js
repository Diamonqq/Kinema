/* One focus interface for every renderer that can show authored close-ups (prepared Daily/book scenes in
   daily_visuals.js; native tutor artifacts through the same adapter).

   A binding is {step_id, scene_id, scene_revision, focus_state_id}. A renderer advertises its states and applies
   one only when the binding names its own scene, its current revision and an advertised id; anything else changes
   nothing. A source reports `displayed` only after the camera move has finished and a frame with the new overlays
   has been drawn.

   Adapter contract (registerFocusSource):
     source.focusInfo()  → { scene_id, scene_revision, states: [{id, label}] } | null
     source.applyFocus(binding) → Promise<boolean>   (false: unknown id, wrong scene/revision, or superseded)
     source.focusState() → the displayed state (see current()) | null
     source.isLive()     → false once destroyed or detached
   window.KinemaFocus.current() returns the newest displayed state among live sources:
     { scene_id, scene_revision, focus_state_id, step_id, label, caption, displayed: true, manual_camera, playing, t } */

const sources = new Set();
let latest = null;

export function registerFocusSource(source) {
  sources.add(source);
  return () => { sources.delete(source); if (latest === source) latest = null; };
}

/* a renderer calls this once a state is on screen (after its ack) */
export function focusDisplayed(source) {
  latest = source;
  const state = source.focusState?.();
  if (state && typeof dispatchEvent === 'function') dispatchEvent(new CustomEvent('kinema:focus-displayed', { detail: state }));
}

/* the binding is valid for this source: its own scene and revision, and an id it advertises */
export function bindingFits(info, binding) {
  return !!(info && binding && binding.scene_id === info.scene_id && binding.scene_revision === info.scene_revision
    && typeof binding.focus_state_id === 'string' && info.states.some(s => s.id === binding.focus_state_id));
}

export function current() {
  const live = [...sources].filter(s => s.isLive?.() !== false);
  const pick = live.includes(latest) ? latest : null;
  const state = pick?.focusState?.() || null;
  return state && state.displayed ? { ...state } : null;
}

if (typeof window !== 'undefined') {
  const api = window.KinemaFocus || {};
  api.current = current;
  api.sources = () => [...sources].filter(s => s.isLive?.() !== false).map(s => s.focusInfo?.()).filter(Boolean);
  window.KinemaFocus = api;
}
