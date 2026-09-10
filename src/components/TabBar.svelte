<!--
  Bottom tab bar, in thumb reach. Three destinations; the Train tab resolves
  to wherever you are in the current block. Overlays (prompts, picker) sit
  above it via z-index so you can't switch away mid-prompt.
-->
<script lang="ts">
  export type Tab = "train" | "blocks" | "cardio" | "settings";
  let { active, onselect }: { active: Tab; onselect: (tab: Tab) => void } = $props();
</script>

<nav class="tabbar" aria-label="Main">
  <button type="button" class:on={active === "train"} onclick={() => onselect("train")} aria-current={active === "train" ? "page" : undefined}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10h2V8h2v8H5v-2H3v-4zm16 0h2v4h-2v2h-2V8h2v2zM9 11h6v2H9v-2z"/></svg>
    <span>Train</span>
  </button>
  <button type="button" class:on={active === "blocks"} onclick={() => onselect("blocks")} aria-current={active === "blocks" ? "page" : undefined}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v3H4V5zm0 5.5h16v3H4v-3zM4 16h16v3H4v-3z"/></svg>
    <span>Blocks</span>
  </button>
  <button type="button" class:on={active === "cardio"} onclick={() => onselect("cardio")} aria-current={active === "cardio" ? "page" : undefined}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.6-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.4-7 10-7 10zm-6.5-9h3l1.5-3 2 6 1.5-3h3v-1.5h-3.9l-.9 1.8-2-6-2.1 4.2H5.5V12z"/></svg>
    <span>Cardio</span>
  </button>
  <button type="button" class:on={active === "settings"} onclick={() => onselect("settings")} aria-current={active === "settings" ? "page" : undefined}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.4 2.1-1.9-.4a6.9 6.9 0 0 0-.7-1.6l1.1-1.6-2-2-1.6 1.1a6.9 6.9 0 0 0-1.6-.7l-.4-1.9h-2.8l-.4 1.9a6.9 6.9 0 0 0-1.6.7L6.9 5 4.9 7l1.1 1.6a6.9 6.9 0 0 0-.7 1.6l-1.9.4v2.8l1.9.4c.2.6.4 1.1.7 1.6L4.9 17l2 2 1.6-1.1c.5.3 1 .5 1.6.7l.4 1.9h2.8l.4-1.9c.6-.2 1.1-.4 1.6-.7l1.6 1.1 2-2-1.1-1.6c.3-.5.5-1 .7-1.6l1.9-.4v-2.8z"/></svg>
    <span>Settings</span>
  </button>
</nav>

<style>
  .tabbar {
    position: fixed;
    left: 0; right: 0; bottom: 0;
    z-index: 5;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    height: calc(var(--tab-h) + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--surface);
    border-top: 1px solid var(--border);
  }
  button {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    border: 0; background: none; color: var(--muted);
    font-size: 0.7rem; font-weight: 600;
    touch-action: manipulation; -webkit-tap-highlight-color: transparent; cursor: pointer;
  }
  button.on { color: var(--accent); }
  svg { width: 26px; height: 26px; fill: currentColor; }
</style>
