<!--
  App shell. No router library: a single `screen` value decides what's
  showing, mirrored into the browser history so the iOS edge-swipe, the
  browser back button, and the on-screen back buttons all do the same thing.
  `{#key}` remounts a screen when its id changes so its queries re-run.
-->
<script lang="ts">
  import { onMount } from "svelte";
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

  const HOME: Screen = { name: "home" };
  let screen = $state<Screen>(HOME);

  /** Forward navigation: push a history entry so "back" returns here. */
  function go(next: Screen, opts: { replace?: boolean } = {}) {
    const depth = (history.state?.depth ?? 0) + (opts.replace ? 0 : 1);
    history[opts.replace ? "replaceState" : "pushState"]({ screen: next, depth }, "");
    screen = next;
  }

  /**
   * Back navigation. Unwind history when there's app history to unwind;
   * otherwise (the app was opened straight onto a deep screen, or history
   * was lost) jump home without pushing.
   */
  function back() {
    if ((history.state?.depth ?? 0) > 0) history.back();
    else go(HOME, { replace: true });
  }

  onMount(() => {
    history.replaceState({ screen: HOME, depth: 0 }, "");
    const onPop = (e: PopStateEvent) => {
      screen = (e.state?.screen as Screen | undefined) ?? HOME;
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  });
</script>

{#if screen.name === "home"}
  <Home
    onNewBlock={() => go({ name: "builder" })}
    onOpenBlock={(mesocycleId) => go({ name: "block", mesocycleId })}
    onSettings={() => go({ name: "settings" })}
  />
{:else if screen.name === "settings"}
  <Settings onBack={back} />
{:else if screen.name === "builder"}
  <!-- After saving, replace the builder entry so back goes home, not to an empty form. -->
  <MesocycleBuilder onSaved={(mesocycleId) => go({ name: "block", mesocycleId }, { replace: true })} onCancel={back} />
{:else if screen.name === "block"}
  {#key screen.mesocycleId}
    {@const mesocycleId = screen.mesocycleId}
    <Block {mesocycleId} onOpenSession={(sessionId) => go({ name: "session", sessionId, mesocycleId })} onBack={back} />
  {/key}
{:else if screen.name === "session"}
  {#key screen.sessionId}
    <Session sessionId={screen.sessionId} onBack={back} />
  {/key}
{/if}
