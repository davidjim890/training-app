<!-- Segmented single-choice control with big tap targets. `bind:value`. -->
<script lang="ts" generics="T extends number">
  let {
    value = $bindable(),
    options,
    label,
  }: { value: T | undefined; options: readonly string[]; label: string } = $props();
</script>

<div class="choice" role="radiogroup" aria-label={label}>
  {#each options as text, i (i)}
    <button
      type="button"
      class="btn"
      class:on={value === i}
      role="radio"
      aria-checked={value === i}
      onclick={() => (value = i as T)}
    >
      {text}
    </button>
  {/each}
</div>

<style>
  .choice { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .btn { font-weight: 500; font-size: 0.95rem; padding: 8px 6px; }
  .btn.on { background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: 700; }
</style>
