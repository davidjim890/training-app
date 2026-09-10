<!--
  Numeric +/- control. The value is a real input so you can also tap it and
  type — two big buttons for small nudges, keyboard for big jumps.
  `bind:value` from the parent.
-->
<script lang="ts">
  let {
    value = $bindable(0),
    min = 0,
    max = 99,
    step = 1,
    label,
  }: { value: number; min?: number; max?: number; step?: number; label: string } = $props();

  // Avoid 82.49999 after repeated 2.5 steps.
  const snap = (n: number) => Math.round(n * 1000) / 1000;
  const dec = () => (value = snap(Math.max(min, value - step)));
  const inc = () => (value = snap(Math.min(max, value + step)));
  function onblur() {
    if (!Number.isFinite(value)) value = min;
    value = snap(Math.min(max, Math.max(min, value)));
  }
</script>

<div class="stepper">
  <span class="label">{label}</span>
  <div class="controls">
    <button type="button" class="btn icon" onclick={dec} disabled={value <= min} aria-label="Decrease {label}">−</button>
    <input
      class="value"
      type="number"
      inputmode={Number.isInteger(step) ? "numeric" : "decimal"}
      bind:value
      {min}
      {max}
      {step}
      {onblur}
      aria-label={label}
    />
    <button type="button" class="btn icon" onclick={inc} disabled={value >= max} aria-label="Increase {label}">+</button>
  </div>
</div>

<style>
  .stepper { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .label { color: var(--muted); font-size: 0.875rem; }
  .controls { display: flex; align-items: center; gap: 6px; }
  .value {
    width: 4.5ch;
    min-height: var(--tap);
    text-align: center;
    font-size: 1.25rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    padding: 0;
    -moz-appearance: textfield;
    appearance: textfield;
  }
  .value:focus { border-color: var(--border); background: var(--surface); outline: none; }
  .value::-webkit-outer-spin-button, .value::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
</style>
