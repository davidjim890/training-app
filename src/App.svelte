<!--
  App shell. No router: a single `screen` value decides what's showing.
  Fine for a handful of screens; revisit only if deep links become useful.
  `{#key}` remounts a screen when its id changes so its queries re-run.
-->
<script lang="ts">
  import Block from "./screens/Block.svelte";
  import Home from "./screens/Home.svelte";
  import MesocycleBuilder from "./screens/MesocycleBuilder.svelte";
  import Session from "./screens/Session.svelte";
  import Settings from "./screens/Settings.svelte";

  type Screen =
    | { name: "home" }
    | { name: "builder" }
    | { name: "settings" }
    | { name: "block"; mesocycleId: number }
    | { name: "session"; sessionId: number; mesocycleId: number };
  let screen = $state<Screen>({ name: "home" });
</script>

{#if screen.name === "home"}
  <Home
    onNewBlock={() => (screen = { name: "builder" })}
    onOpenBlock={(mesocycleId) => (screen = { name: "block", mesocycleId })}
    onSettings={() => (screen = { name: "settings" })}
  />
{:else if screen.name === "settings"}
  <Settings onBack={() => (screen = { name: "home" })} />
{:else if screen.name === "builder"}
  <MesocycleBuilder onSaved={(mesocycleId) => (screen = { name: "block", mesocycleId })} onCancel={() => (screen = { name: "home" })} />
{:else if screen.name === "block"}
  {#key screen.mesocycleId}
    {@const mesocycleId = screen.mesocycleId}
    <Block
      {mesocycleId}
      onOpenSession={(sessionId) => (screen = { name: "session", sessionId, mesocycleId })}
      onBack={() => (screen = { name: "home" })}
    />
  {/key}
{:else if screen.name === "session"}
  {#key screen.sessionId}
    {@const mesocycleId = screen.mesocycleId}
    <Session sessionId={screen.sessionId} onBack={() => (screen = { name: "block", mesocycleId })} />
  {/key}
{/if}
